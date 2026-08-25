import "server-only";
import { generateImage, type Provider, type Tier } from "./image-providers";
import type { Placement } from "./placements";
import { insertGeneration, uploadGeneratedImage, type Generation } from "./generations";

export type GenerationBatchInput = {
  brandId: string | null;
  prompt: string;
  provider: Provider;
  tier: Tier;
  placements: Placement[];
  referenceImages: { base64: string; mimeType: string }[];
  /** Only set for the brand-scoped Creative Track — free-prompt generations
   *  have no separate label/hook/cta, the prompt is the whole brief. */
  copy?: { label: string; hook: string; cta: string };
  /** Defaults to "creative" (matches the DB column default) if omitted. */
  track?: Generation["track"];
};

/** Fires one generation per placement in parallel, uploading + recording
 *  each result (or failure) as it completes. Shared by both generation
 *  entry points (brand-scoped and free-prompt) and their MCP equivalents —
 *  the only difference between callers is how `prompt`/`copy` get built. */
export async function runGenerationBatch(
  input: GenerationBatchInput
): Promise<{ batchId: string; results: Generation[] }> {
  const batchId = crypto.randomUUID();

  const results = await Promise.all(
    input.placements.map(async (placement) => {
      try {
        const image = await generateImage(input.provider, {
          prompt: input.prompt,
          tier: input.tier,
          placement,
          referenceImages: input.referenceImages,
        });
        const imageUrl = await uploadGeneratedImage(
          input.brandId,
          placement.id,
          image.imageBase64,
          image.mimeType
        );
        return insertGeneration({
          brand_id: input.brandId,
          batch_id: batchId,
          track: input.track,
          placement: placement.id,
          model_used: image.modelUsed,
          prompt_used: input.prompt,
          copy_label: input.copy?.label,
          copy_hook: input.copy?.hook,
          copy_cta: input.copy?.cta,
          image_url: imageUrl,
          est_cost_usd: image.estCostUsd,
          status: "complete",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return insertGeneration({
          brand_id: input.brandId,
          batch_id: batchId,
          track: input.track,
          placement: placement.id,
          prompt_used: input.prompt,
          status: "failed",
          error_message: message,
        });
      }
    })
  );

  return { batchId, results };
}
