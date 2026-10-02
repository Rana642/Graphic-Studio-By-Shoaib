import "server-only";
import { BATCH_DISCOUNT, type BatchItemResult, type BatchPollResult, type GenerateImageInput, type GenerateImageResult, type ImageProviderClient } from "./types";
import { shrinkReferenceForBatch } from "./batch-utils";

/**
 * Model IDs confirmed live against Shoaib's own OpenAI key on 2026-08-24
 * (via /v1/models). Costs are ballpark from public pricing at the same
 * date — re-check OpenAI's pricing page before relying on them for real
 * budgeting.
 */
const CONFIG_BY_TIER: Record<
  GenerateImageInput["tier"],
  { model: string; quality?: "low" | "medium" | "high"; estCostUsd: number }
> = {
  premium: { model: "gpt-image-2", quality: "high", estCostUsd: 0.19 },
  standard: { model: "gpt-image-2", quality: "medium", estCostUsd: 0.045 },
  draft: { model: "gpt-image-1-mini", estCostUsd: 0.005 },
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

export const gptImageProvider: ImageProviderClient = {
  provider: "gpt-image",

  async generate(input: GenerateImageInput): Promise<GenerateImageResult> {
    if (!API_KEY) throw new Error("OPENAI_API_KEY is not configured.");

    const { model, quality, estCostUsd } = CONFIG_BY_TIER[input.tier];
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
    const { model, quality, estCostUsd } = CONFIG_BY_TIER[input.tier];
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
