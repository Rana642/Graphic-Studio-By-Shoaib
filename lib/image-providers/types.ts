import type { Placement } from "../placements";

export type Provider = "nano-banana" | "gpt-image";

/**
 * "premium" = best-quality model (Nano Banana Pro / GPT Image 2 high) —
 * "draft" = cheapest model, for concepting before spending on a final export.
 * Matches the hybrid strategy from Shoaib's own research: cheap draft to
 * approve a concept, premium for the real export.
 */
export type Tier = "draft" | "standard" | "premium";

export type GenerateImageInput = {
  prompt: string;
  tier: Tier;
  placement: Placement;
  /** Existing client posts/graphics for this brand, for style consistency.
   *  Only Nano Banana's generateContent actually accepts inline reference
   *  images alongside the prompt — GPT Image's basic generations endpoint
   *  is text-only, so gptImage.ts ignores this. */
  referenceImages?: { base64: string; mimeType: string }[];
};

export type GenerateImageResult = {
  imageBase64: string;
  mimeType: string;
  modelUsed: string;
  estCostUsd: number;
};

export type ImageProviderClient = {
  provider: Provider;
  generate(input: GenerateImageInput): Promise<GenerateImageResult>;
};
