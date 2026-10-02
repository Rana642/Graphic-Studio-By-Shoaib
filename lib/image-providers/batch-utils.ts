import "server-only";
import sharp from "sharp";

/** A batch request carries its reference images inside the job (repeated per
 *  item on OpenAI), so they're shrunk first: long edge ≤ 1536 px — the
 *  largest size either provider renders at — as high-quality JPEG. */
export async function shrinkReferenceForBatch(ref: { base64: string; mimeType: string }): Promise<{ base64: string; mimeType: string }> {
  const out = await sharp(Buffer.from(ref.base64, "base64"))
    .rotate()
    .resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { base64: out.toString("base64"), mimeType: "image/jpeg" };
}
