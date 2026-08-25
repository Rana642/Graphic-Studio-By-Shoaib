import "server-only";
import type { Provider, GenerateImageInput, GenerateImageResult } from "./types";
import { nanoBananaProvider } from "./nanoBanana";
import { gptImageProvider } from "./gptImage";

export type { Provider, Tier, GenerateImageInput, GenerateImageResult } from "./types";

const providers = {
  "nano-banana": nanoBananaProvider,
  "gpt-image": gptImageProvider,
} as const;

export function generateImage(
  provider: Provider,
  input: GenerateImageInput
): Promise<GenerateImageResult> {
  return providers[provider].generate(input);
}
