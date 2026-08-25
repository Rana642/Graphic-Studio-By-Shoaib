import "server-only";
import { getAssetLockedTemplate } from "./templates";
import { renderTemplate } from "./render";
import { autoRetouchPhoto } from "../retouch";
import { insertGeneration, uploadGeneratedImage, type Generation } from "../generations";
import { getBrand } from "../brands";

export async function generateAssetLocked(input: {
  templateId: string;
  brandId: string | null;
  fieldValues: Record<string, string>;
  photoBuffer: Buffer;
}): Promise<Generation> {
  const template = getAssetLockedTemplate(input.templateId);
  if (!template) {
    throw new Error(`No Asset-Locked template found with id '${input.templateId}'.`);
  }

  const brand = input.brandId ? await getBrand(input.brandId) : null;

  try {
    // Same exposure/contrast pass as Track B — the real photo (often a real
    // room, event, or person) gets basic correction before anything is
    // composited on top of it. Deterministic, so it never touches content.
    const retouchedPhoto = await autoRetouchPhoto(input.photoBuffer);

    const frameSvg = template.buildFrameSvg(input.fieldValues, brand);
    const finalPng = await renderTemplate({
      frameSvg,
      photoBuffer: retouchedPhoto,
      canvasWidth: template.canvasWidth,
      canvasHeight: template.canvasHeight,
    });

    const imageUrl = await uploadGeneratedImage(
      input.brandId,
      template.id,
      finalPng.toString("base64"),
      "image/png"
    );

    return insertGeneration({
      brand_id: input.brandId,
      batch_id: crypto.randomUUID(),
      track: "asset_locked",
      placement: template.id,
      template_id: template.id,
      image_url: imageUrl,
      status: "complete",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return insertGeneration({
      brand_id: input.brandId,
      batch_id: crypto.randomUUID(),
      track: "asset_locked",
      placement: template.id,
      template_id: template.id,
      status: "failed",
      error_message: message,
    });
  }
}
