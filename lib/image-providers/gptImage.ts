import "server-only";
import type { GenerateImageInput, GenerateImageResult, ImageProviderClient } from "./types";

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
};
