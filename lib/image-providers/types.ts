import type { Placement } from "../placements";

export type Provider = "nano-banana" | "gpt-image";

/**
 * "premium" = best-quality model (Nano Banana Pro / GPT Image 2 high) —
 * "draft" = cheapest model, for concepting before spending on a final export.
 * Matches the hybrid strategy from Shoaib's own research: cheap draft to
 * approve a concept, premium for the real export.
 */
export type Tier = "draft" | "standard" | "premium";

/** "instant" = the normal synchronous API call, image back in seconds.
 *  "batch" = the provider's Batch API: same model and quality, half the
 *  price, results within 24 hours (usually much sooner). */
export type Delivery = "instant" | "batch";

/** Both OpenAI's and Google's Batch APIs bill at 50% of the synchronous price. */
export const BATCH_DISCOUNT = 0.5;

export type GenerateImageInput = {
  prompt: string;
  tier: Tier;
  placement: Placement;
  /** Existing client posts/graphics for this brand, for style consistency.
   *  Nano Banana takes these as inline parts alongside the prompt on the
   *  same generateContent call; GPT Image routes to /v1/images/edits
   *  instead of /v1/images/generations when this is non-empty, since only
   *  the edits endpoint accepts input images. */
  referenceImages?: { base64: string; mimeType: string }[];
};

export type GenerateImageResult = {
  imageBase64: string;
  mimeType: string;
  modelUsed: string;
  estCostUsd: number;
};

/** One provider batch job: every item shares the tier and reference images;
 *  `key` comes back with each result (we use the generations row id). */
export type BatchSubmitInput = {
  tier: Tier;
  referenceImages: { base64: string; mimeType: string }[];
  items: { key: string; prompt: string; placement: Placement }[];
  /** Shows up in the provider's dashboard next to the job. */
  label: string;
};

export type BatchSubmitResult = {
  /** OpenAI "batch_…" id or Gemini "batches/…" name. */
  jobId: string;
  modelUsed: string;
  /** Per image, already discounted. */
  estCostUsd: number;
};

export type BatchItemResult =
  | { key: string; imageBase64: string; mimeType: string }
  | { key: string; error: string };

export type BatchPollResult =
  | { state: "running" }
  /** Finished (fully or partly — an expired job still returns what it made).
   *  A key missing from `results` never produced an image. */
  | { state: "done"; results: BatchItemResult[]; note?: string }
  | { state: "failed"; error: string };

export type ImageProviderClient = {
  provider: Provider;
  generate(input: GenerateImageInput): Promise<GenerateImageResult>;
  submitBatch(input: BatchSubmitInput): Promise<BatchSubmitResult>;
  pollBatch(jobId: string): Promise<BatchPollResult>;
};
