import "server-only";
import type { Provider, GenerateImageInput, GenerateImageResult, BatchSubmitInput, BatchSubmitResult, BatchPollResult } from "./types";
import { nanoBananaProvider } from "./nanoBanana";
import { gptImageProvider } from "./gptImage";
import { fluxProvider } from "./flux";

export type { Provider, Tier, Delivery, GenerateImageInput, GenerateImageResult } from "./types";
export { BATCH_DISCOUNT, PROVIDERS, PROVIDER_LABEL, providerHasBatch, providerOfModel } from "./types";

const providers = {
  "nano-banana": nanoBananaProvider,
  "gpt-image": gptImageProvider,
  flux: fluxProvider,
} as const;

export function generateImage(
  provider: Provider,
  input: GenerateImageInput
): Promise<GenerateImageResult> {
  return providers[provider].generate(input);
}

export function submitImageBatch(provider: Provider, input: BatchSubmitInput): Promise<BatchSubmitResult> {
  return providers[provider].submitBatch(input);
}

/** Gemini job names start with "batches/", OpenAI ids with "batch_" (FLUX
 *  has no batch jobs). */
export function providerOfJob(jobId: string): Provider {
  return jobId.startsWith("batches/") ? "nano-banana" : "gpt-image";
}

export function pollImageBatch(jobId: string): Promise<BatchPollResult> {
  return providers[providerOfJob(jobId)].pollBatch(jobId);
}
