import "server-only";
import { BATCH_DISCOUNT, type BatchItemResult, type BatchPollResult, type Complexity, type GenerateImageInput, type Tier, type GenerateImageResult, type ImageProviderClient } from "./types";
import { shrinkReferenceForBatch } from "./batch-utils";

/**
 * Model IDs confirmed live against Shoaib's own OpenAI key on 2026-10-07
 * (via /v1/models). GPT Image 2.5 (2026-09-08) shifted the quality ladder
 * down a rung: 2.5 "high" costs what gpt-image-2 "medium" did, and 2.5
 * "max" what gpt-image-2 "high" did. Sunburst is the detail / edit-fidelity
 * variant (labels and small print survive close inspection); Flare is the
 * fast one, fine for drafts. Costs are ballpark per 1024×1024 image from
 * public pricing at the same date — re-check OpenAI's pricing page before
 * relying on them for real budgeting.
 */
type TierConfig = Record<
  GenerateImageInput["tier"],
  { model: string; quality?: "low" | "medium" | "high" | "xhigh" | "max"; estCostUsd: number }
>;

/**
 * Instant calls use GPT Image 2.6 (2026-11-04; both ids are on Shoaib's key).
 * The estCostUsd values are the 2.5 ballparks carried over: 2.6 uses the same
 * token rates, but sources disagree on the per-image price at low quality, so
 * they stay until a real run shows the billed cost.
 */
const INSTANT_CONFIG: TierConfig = {
  premium: { model: "gpt-image-2.6-sunburst", quality: "max", estCostUsd: 0.21 },
  standard: { model: "gpt-image-2.6-sunburst", quality: "high", estCostUsd: 0.053 },
  draft: { model: "gpt-image-2.6-flare", quality: "low", estCostUsd: 0.006 },
};

/** The 2.6 models don't support OpenAI's Batch API (their model pages list
 *  v1/batch as "Not supported"), so Batch delivery stays on 2.5. */
const BATCH_CONFIG: TierConfig = {
  premium: { model: "gpt-image-2.5-sunburst", quality: "max", estCostUsd: 0.21 },
  standard: { model: "gpt-image-2.5-sunburst", quality: "high", estCostUsd: 0.053 },
  draft: { model: "gpt-image-2.5-flare", quality: "low", estCostUsd: 0.006 },
};

const API_KEY = process.env.OPENAI_API_KEY || "";

async function extractImage(res: Response, model: string): Promise<string> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GPT Image (${model}) failed: ${res.status} ${body}`);
  }
  const json = await res.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`GPT Image (${model}) returned no image data.`);
  return b64;
}

async function openai(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`https://api.openai.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${API_KEY}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`OpenAI ${path} failed: ${res.status} ${await res.text()}`);
  return res;
}

type BatchLine = {
  custom_id?: string;
  response?: { status_code?: number; body?: { data?: { b64_json?: string }[]; error?: { message?: string } } } | null;
  error?: { message?: string } | null;
};

/** Output and error files are JSONL — one line per request, keyed by custom_id. */
async function readBatchFile(fileId: string | null | undefined): Promise<BatchItemResult[]> {
  if (!fileId) return [];
  const text = await (await openai(`/files/${fileId}/content`)).text();
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const row = JSON.parse(line) as BatchLine;
      const key = row.custom_id ?? "";
      const b64 = row.response?.body?.data?.[0]?.b64_json;
      if (row.response?.status_code === 200 && b64) return { key, imageBase64: b64, mimeType: "image/png" };
      return { key, error: row.error?.message ?? row.response?.body?.error?.message ?? `HTTP ${row.response?.status_code ?? "?"}` };
    });
}

/**
 * Markup-guided edit (GPT Image 2.6 only): `markup` is a transparent PNG the
 * same pixel size as `image` that marks where the change goes. The markup
 * applies to the first image only; `mask` and `input_fidelity` are left out,
 * as the model page requires. Instant only (2.6 has no Batch API).
 */
export async function editWithMarkup(input: {
  image: { base64: string; mimeType: string };
  /** PNG with an alpha channel. */
  markupBase64: string;
  prompt: string;
  tier: Tier;
  complexity?: Complexity;
}): Promise<GenerateImageResult> {
  if (!API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  const { model, quality, estCostUsd } = INSTANT_CONFIG[input.tier];

  const form = new FormData();
  form.append("model", model);
  form.append("prompt", input.prompt);
  if (quality) form.append("quality", quality);
  if (input.complexity) form.append("complexity", input.complexity);
  const ext = input.image.mimeType.split("/")[1] || "png";
  form.append("image", new Blob([Uint8Array.from(Buffer.from(input.image.base64, "base64"))], { type: input.image.mimeType }), `source.${ext}`);
  form.append("markup", new Blob([Uint8Array.from(Buffer.from(input.markupBase64, "base64"))], { type: "image/png" }), "markup.png");

  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  const imageBase64 = await extractImage(res, model);
  return { imageBase64, mimeType: "image/png", modelUsed: model, estCostUsd };
}

export const gptImageProvider: ImageProviderClient = {
  provider: "gpt-image",

  async generate(input: GenerateImageInput): Promise<GenerateImageResult> {
    if (!API_KEY) throw new Error("OPENAI_API_KEY is not configured.");

    const { model, quality, estCostUsd } = INSTANT_CONFIG[input.tier];
    const complexity = input.complexity; // every instant model is 2.6, which takes it
    const authHeader = { Authorization: `Bearer ${API_KEY}` };

    let imageBase64: string;

    if (input.referenceImages && input.referenceImages.length > 0) {
      // /v1/images/edits — the only OpenAI endpoint that accepts input
      // images. Multipart form-data, not JSON: each reference goes in as
      // its own image[] file part, plus the prompt/size/quality fields.
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", input.prompt);
      form.append("size", input.placement.openaiSize);
      if (quality) form.append("quality", quality);
      if (complexity) form.append("complexity", complexity);
      input.referenceImages.forEach((ref, i) => {
        const buffer = Buffer.from(ref.base64, "base64");
        const blob = new Blob([buffer], { type: ref.mimeType });
        const ext = ref.mimeType.split("/")[1] || "png";
        form.append("image[]", blob, `reference-${i}.${ext}`);
      });

      const res = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: authHeader,
        body: form,
      });
      imageBase64 = await extractImage(res, model);
    } else {
      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: input.prompt,
          size: input.placement.openaiSize,
          ...(quality ? { quality } : {}),
          ...(complexity ? { complexity } : {}),
        }),
      });
      imageBase64 = await extractImage(res, model);
    }

    return { imageBase64, mimeType: "image/png", modelUsed: model, estCostUsd };
  },

  /** Batch API: the requests go up as a JSONL file, then one batch job runs
   *  them all. A batch can only target one endpoint, so with reference
   *  images every line is an /images/edits call (images as data URLs —
   *  JSON lines can't carry multipart files). */
  async submitBatch(input) {
    if (!API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
    const { model, quality, estCostUsd } = BATCH_CONFIG[input.tier];
    const refs = await Promise.all(input.referenceImages.map(shrinkReferenceForBatch));
    const endpoint = refs.length > 0 ? "/v1/images/edits" : "/v1/images/generations";

    const jsonl = input.items
      .map((item) =>
        JSON.stringify({
          custom_id: item.key,
          method: "POST",
          url: endpoint,
          body: {
            model,
            prompt: item.prompt,
            size: item.placement.openaiSize,
            ...(quality ? { quality } : {}),
            ...(refs.length > 0 ? { images: refs.map((r) => ({ image_url: `data:${r.mimeType};base64,${r.base64}` })) } : {}),
          },
        })
      )
      .join("\n");

    const form = new FormData();
    form.append("purpose", "batch");
    form.append("file", new Blob([jsonl], { type: "application/jsonl" }), "graphic-studio-batch.jsonl");
    const file = (await (await openai("/files", { method: "POST", body: form })).json()) as { id: string };

    const batch = (await (
      await openai("/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input_file_id: file.id, endpoint, completion_window: "24h", metadata: { app: "graphic-studio", label: input.label.slice(0, 500) } }),
      })
    ).json()) as { id: string };

    return { jobId: batch.id, modelUsed: model, estCostUsd: estCostUsd * BATCH_DISCOUNT };
  },

  async pollBatch(jobId): Promise<BatchPollResult> {
    if (!API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
    const batch = (await (await openai(`/batches/${jobId}`)).json()) as {
      status: string;
      output_file_id?: string | null;
      error_file_id?: string | null;
      errors?: { data?: { message?: string }[] } | null;
    };

    if (["validating", "in_progress", "finalizing", "cancelling"].includes(batch.status)) return { state: "running" };
    if (batch.status === "failed") {
      return { state: "failed", error: batch.errors?.data?.map((e) => e.message).filter(Boolean).join("; ") || "OpenAI rejected the batch." };
    }
    // completed / expired / cancelled — whatever finished is in the files.
    const results = [...(await readBatchFile(batch.output_file_id)), ...(await readBatchFile(batch.error_file_id))];
    return {
      state: "done",
      results,
      note: batch.status === "completed" ? undefined : `OpenAI batch ${batch.status} before every image was made.`,
    };
  },
};
