import "server-only";
import type { GenerateImageInput, GenerateImageResult, ImageProviderClient } from "./types";

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

export const nanoBananaProvider: ImageProviderClient = {
  provider: "nano-banana",

  async generate(input: GenerateImageInput): Promise<GenerateImageResult> {
    if (!API_KEY) throw new Error("GOOGLE_AI_STUDIO_API_KEY is not configured.");

    const { model, estCostUsd } = MODEL_BY_TIER[input.tier];

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: input.prompt }] }],
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
};
