import "server-only";
import { getGeneration, recordUpscale, uploadGeneratedImage, type Generation } from "./generations";
import { getPlacement } from "./placements";
import { upscaleWithTopaz, type TopazModel } from "./enhancers/topaz";

export const UPSCALE_SCALES = [2, 4, 6] as const;
export type UpscaleScale = (typeof UPSCALE_SCALES)[number];

const MAX_TOPAZ_OUTPUT_DIMENSION = 32000;

/** Runs an already-generated image through Topaz to upscale it, records
 *  the result on the same generation row, and returns the updated row.
 *  Target resolution is the placement's base size × scale — placement is
 *  looked up from the generation's own `placement` field rather than
 *  asking the caller for raw pixel dimensions. */
export async function enhanceGeneration(
  generationId: string,
  options: { scale: UpscaleScale; model?: TopazModel }
): Promise<Generation> {
  const generation = await getGeneration(generationId);
  if (!generation) throw new Error(`No generation found with id '${generationId}'.`);
  if (generation.status !== "complete" || !generation.image_url) {
    throw new Error(`Generation '${generationId}' has no completed image to enhance.`);
  }

  const placement = getPlacement(generation.placement);
  const outputWidth = Math.min(
    MAX_TOPAZ_OUTPUT_DIMENSION,
    (placement?.width ?? 1024) * options.scale
  );
  const outputHeight = Math.min(
    MAX_TOPAZ_OUTPUT_DIMENSION,
    (placement?.height ?? 1024) * options.scale
  );

  const sourceRes = await fetch(generation.image_url);
  if (!sourceRes.ok) {
    throw new Error(`Could not fetch the original image to enhance: ${sourceRes.status}`);
  }
  const mimeType = sourceRes.headers.get("content-type") || "image/png";
  const imageBuffer = Buffer.from(await sourceRes.arrayBuffer());

  const result = await upscaleWithTopaz(
    { imageBuffer, mimeType, outputWidth, outputHeight },
    options.model
  );

  const upscaledImageUrl = await uploadGeneratedImage(
    generation.brand_id,
    `${generation.placement}-upscaled`,
    result.imageBuffer.toString("base64"),
    result.mimeType
  );

  return recordUpscale(generationId, {
    upscaledImageUrl,
    provider: "topaz",
    costUsd: result.estCostUsd,
  });
}
