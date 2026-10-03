import "server-only";
import { BATCH_DISCOUNT, type BatchItemResult, type BatchPollResult, type GenerateImageInput, type GenerateImageResult, type ImageProviderClient } from "./types";
import { shrinkReferenceForBatch } from "./batch-utils";

/**
 * Model IDs and per-image cost estimates confirmed live against Shoaib's
 * own Google AI Studio key on 2026-08-24 (via /v1beta/models). Costs are
 * ballpark from public pricing at the same date — re-check
 * https://ai.google.dev/gemini-api/docs/pricing before relying on them for
 * real budgeting; Google's pricing pages change.
 */
const MODEL_BY_TIER: Record<GenerateImageInput["tier"], { model: string; estCostUsd: number }> = {
  premium: { model: "gemini-3-pro-image", estCostUsd: 0.134 }, // "Nano Banana Pro"
  standard: { model: "gemini-3.1-flash-image", estCostUsd: 0.04 }, // "Nano Banana 2"
  draft: { model: "gemini-2.5-flash-image", estCostUsd: 0.02 }, // "Nano Banana"
};

const API_KEY = process.env.GOOGLE_AI_STUDIO_API_KEY || "";
const BASE = "https://generativelanguage.googleapis.com";
// Neutral on purpose: the prompt's IMAGE REFERENCES line (lib/prompt-contract.ts)
// says what each image is — logo, product, subject or style reference.
const REFERENCE_LEAD_IN =
  "Reference images follow, in order (image 1, image 2, …). The instructions after them say what each one is and how to use it.";

async function gemini(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "x-goog-api-key": API_KEY, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`Gemini ${path.split("?")[0]} failed: ${res.status} ${await res.text()}`);
  return res;
}

/** Files API upload (resumable protocol, start + finalize in one go). A batch
 *  job references each reference image once by URI instead of repeating the
 *  bytes in every request — inline batch input is capped at 20 MB. Files
 *  expire on Google's side after 48 h, longer than any batch runs. */
async function uploadFile(ref: { base64: string; mimeType: string }, name: string): Promise<{ uri: string; mimeType: string }> {
  const bytes = Buffer.from(ref.base64, "base64");
  const start = await gemini("/upload/v1beta/files", {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.length),
      "X-Goog-Upload-Header-Content-Type": ref.mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: name } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini Files API returned no upload URL.");
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: bytes,
  });
  if (!res.ok) throw new Error(`Gemini file upload failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { file?: { uri?: string; mimeType?: string } };
  if (!json.file?.uri) throw new Error("Gemini file upload returned no file URI.");
  return { uri: json.file.uri, mimeType: json.file.mimeType ?? ref.mimeType };
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
};

function imageFrom(key: string, response: GeminiResponse | undefined): BatchItemResult {
  const part = response?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (part?.inlineData) return { key, imageBase64: part.inlineData.data, mimeType: part.inlineData.mimeType };
  const why = response?.promptFeedback?.blockReason ?? response?.candidates?.[0]?.finishReason;
  return { key, error: `No image returned${why ? ` (${why})` : ""}.` };
}

type InlinedResponse = { response?: GeminiResponse; error?: { message?: string }; metadata?: { key?: string } };

export const nanoBananaProvider: ImageProviderClient = {
  provider: "nano-banana",

  async generate(input: GenerateImageInput): Promise<GenerateImageResult> {
    if (!API_KEY) throw new Error("GOOGLE_AI_STUDIO_API_KEY is not configured.");

    const { model, estCostUsd } = MODEL_BY_TIER[input.tier];

    // Reference images go in first as inlineData parts, with a short lead-in
    // line, then the real prompt — this ordering + framing is what makes
    // Gemini treat them as style context rather than "the subject to edit."
    const hasReferences = (input.referenceImages?.length ?? 0) > 0;
    const requestParts = [
      ...(hasReferences
        ? [
            { text: REFERENCE_LEAD_IN },
            ...input.referenceImages!.map((ref) => ({
              inlineData: { mimeType: ref.mimeType, data: ref.base64 },
            })),
          ]
        : []),
      { text: input.prompt },
    ];

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: requestParts }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: { aspectRatio: input.placement.geminiAspectRatio },
          },
        }),
      }
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Nano Banana (${model}) failed: ${res.status} ${body}`);
    }

    const json = await res.json();
    const parts: Array<{ inlineData?: { mimeType: string; data: string } }> =
      json?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.data);
    if (!imagePart?.inlineData) {
      throw new Error(`Nano Banana (${model}) returned no image data.`);
    }

    return {
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType,
      modelUsed: model,
      estCostUsd,
    };
  },

  /** Batch Mode: one batchGenerateContent job with inline requests, each the
   *  same shape as the instant call; reference images go through the Files
   *  API once and are referenced by URI. */
  async submitBatch(input) {
    if (!API_KEY) throw new Error("GOOGLE_AI_STUDIO_API_KEY is not configured.");
    const { model, estCostUsd } = MODEL_BY_TIER[input.tier];
    const refs = await Promise.all(
      input.referenceImages.map(async (r, i) => uploadFile(await shrinkReferenceForBatch(r), `${input.label.slice(0, 80)} ref ${i + 1}`))
    );
    const refParts = refs.length
      ? [{ text: REFERENCE_LEAD_IN }, ...refs.map((f) => ({ fileData: { mimeType: f.mimeType, fileUri: f.uri } }))]
      : [];

    const res = await gemini(`/v1beta/models/${model}:batchGenerateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batch: {
          display_name: input.label.slice(0, 120),
          input_config: {
            requests: {
              requests: input.items.map((item) => ({
                request: {
                  contents: [{ parts: [...refParts, { text: item.prompt }] }],
                  generationConfig: {
                    responseModalities: ["IMAGE"],
                    imageConfig: { aspectRatio: item.placement.geminiAspectRatio },
                  },
                },
                metadata: { key: item.key },
              })),
            },
          },
        },
      }),
    });
    const json = (await res.json()) as { name?: string };
    if (!json.name) throw new Error("Gemini batch create returned no batch name.");
    return { jobId: json.name, modelUsed: model, estCostUsd: estCostUsd * BATCH_DISCOUNT };
  },

  async pollBatch(jobId): Promise<BatchPollResult> {
    if (!API_KEY) throw new Error("GOOGLE_AI_STUDIO_API_KEY is not configured.");
    type Output = { inlinedResponses?: { inlinedResponses?: InlinedResponse[] } | InlinedResponse[]; responsesFile?: string };
    const json = (await (await gemini(`/v1beta/${jobId}`)).json()) as {
      state?: string;
      metadata?: { state?: string; output?: Output };
      response?: Output;
      output?: Output;
      error?: { message?: string };
    };
    // The REST guide wraps the batch in an operation (metadata.state,
    // JOB_STATE_*), the reference shows it bare (state, BATCH_STATE_*) —
    // accept both by the state's suffix.
    const state = json.metadata?.state ?? json.state ?? "";
    if (/PENDING|RUNNING|UNSPECIFIED/.test(state) || !state) return { state: "running" };
    if (/FAILED/.test(state)) return { state: "failed", error: json.error?.message ?? "Gemini batch failed." };

    const output = json.response ?? json.output ?? json.metadata?.output;
    const inlined = output?.inlinedResponses;
    const list: InlinedResponse[] = Array.isArray(inlined) ? inlined : inlined?.inlinedResponses ?? [];
    const results: BatchItemResult[] = list.map((r, i) => {
      const key = r.metadata?.key ?? `#${i}`;
      return r.error ? { key, error: r.error.message ?? "Request failed." } : imageFrom(key, r.response);
    });

    if (output?.responsesFile) {
      const text = await (await gemini(`/download/v1beta/${output.responsesFile}:download?alt=media`)).text();
      for (const line of text.split("\n").filter((l) => l.trim())) {
        const row = JSON.parse(line) as { key?: string; response?: GeminiResponse; error?: { message?: string } };
        const key = row.key ?? "";
        results.push(row.error ? { key, error: row.error.message ?? "Request failed." } : imageFrom(key, row.response));
      }
    }

    return {
      state: "done",
      results,
      note: /SUCCEEDED/.test(state) ? undefined : `Gemini batch ${state.replace(/^(JOB|BATCH)_STATE_/, "").toLowerCase()} before every image was made.`,
    };
  },
};
