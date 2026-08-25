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

export const gptImageProvider: ImageProviderClient = {
  provider: "gpt-image",

  async generate(input: GenerateImageInput): Promise<GenerateImageResult> {
    if (!API_KEY) throw new Error("OPENAI_API_KEY is not configured.");

    // input.referenceImages is intentionally unused here — the basic
    // /v1/images/generations endpoint is text-only. Style-consistency via
    // reference images currently only works on the Nano Banana provider
    // (see nanoBanana.ts). If GPT Image support is needed later, that's
    // OpenAI's /v1/images/edits endpoint instead, a different request shape.
    const { model, quality, estCostUsd } = CONFIG_BY_TIER[input.tier];

    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: input.prompt,
        size: input.placement.openaiSize,
        ...(quality ? { quality } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GPT Image (${model}) failed: ${res.status} ${body}`);
    }

    const json = await res.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error(`GPT Image (${model}) returned no image data.`);
    }

    return {
      imageBase64: b64,
      mimeType: "image/png",
      modelUsed: model,
      estCostUsd,
    };
  },
};
