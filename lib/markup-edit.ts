import "server-only";
import sharp from "sharp";
import { editWithMarkup, type Complexity, type Tier } from "./image-providers";
import { insertGeneration, uploadGeneratedImage, type Generation } from "./generations";
import { judgeImage, qualityNote } from "./quality-gate";
import { quotedText } from "./prompt-contract";

/** GPT Image 2.6 limit: the source and the markup layer may each hold at most this many pixels. */
const MAX_PIXELS = 16_777_216;

type Img = { base64: string; mimeType: string };

/** A mark drawn on the transparent layer. Positions are fractions (0–1) of the image. */
export type MarkupRegion =
  | { shape: "rect" | "ellipse"; x: number; y: number; w: number; h: number; color?: string }
  | { shape: "arrow"; x: number; y: number; x2: number; y2: number; color?: string };

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Builds the transparent PNG layer from a list of regions (used by the MCP tool; the web page draws its own). */
export async function renderRegionsOverlay(width: number, height: number, regions: MarkupRegion[]): Promise<Buffer> {
  const stroke = Math.max(4, Math.round(Math.min(width, height) * 0.006));
  const px = (v: number, size: number) => Math.round(Math.min(1, Math.max(0, v)) * size);
  const shapes = regions
    .map((r) => {
      const color = r.color && HEX_COLOR.test(r.color) ? r.color : "#ff0000";
      const common = `fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"`;
      if (r.shape === "arrow") {
        const x1 = px(r.x, width), y1 = px(r.y, height), x2 = px(r.x2, width), y2 = px(r.y2, height);
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const head = stroke * 5;
        const left = `${x2 - head * Math.cos(angle - 0.45)},${y2 - head * Math.sin(angle - 0.45)}`;
        const right = `${x2 - head * Math.cos(angle + 0.45)},${y2 - head * Math.sin(angle + 0.45)}`;
        return `<path d="M${x1},${y1} L${x2},${y2} M${left} L${x2},${y2} L${right}" ${common}/>`;
      }
      const x = px(r.x, width), y = px(r.y, height), w = px(r.w, width), h = px(r.h, height);
      return r.shape === "ellipse"
        ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${common}/>`
        : `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${common}/>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shapes}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Makes the image and markup pixel-identical in size and under the pixel limit. */
async function prepareInputs(image: Img, markupBase64: string): Promise<{ image: Img; markupBase64: string }> {
  const source = sharp(Buffer.from(image.base64, "base64"));
  const meta = await source.metadata();
  if (!meta.width || !meta.height) throw new Error("Couldn't read the image size.");
  const scale = meta.width * meta.height > MAX_PIXELS ? Math.sqrt(MAX_PIXELS / (meta.width * meta.height)) : 1;
  const width = Math.floor(meta.width * scale);
  const height = Math.floor(meta.height * scale);

  const imageBuffer = scale < 1 ? await source.resize(width, height).png().toBuffer() : Buffer.from(image.base64, "base64");
  const markupBuffer = await sharp(Buffer.from(markupBase64, "base64"))
    .ensureAlpha()
    .resize(width, height, { fit: "fill" })
    .png()
    .toBuffer();
  return {
    image: { base64: imageBuffer.toString("base64"), mimeType: scale < 1 ? "image/png" : image.mimeType },
    markupBase64: markupBuffer.toString("base64"),
  };
}

const wrapPrompt = (change: string) =>
  [
    "Edit the first image. The second image is a transparent markup layer: the marks show WHERE the change goes.",
    "Apply the change only at the marked places and keep everything else exactly as it is (same layout, colours, logo, faces and text).",
    "Do not draw the markup marks themselves in the result.",
    `CHANGE: ${change}`,
  ].join("\n");

/**
 * One markup-guided edit: generate, score with the quality gate (no automatic
 * retry — a second image would cost again), upload, and record the row under
 * track "markup_edit". Failures are recorded, not thrown.
 */
export async function runMarkupEdit(input: {
  brandId: string | null;
  prompt: string;
  tier: Tier;
  complexity?: Complexity;
  image: Img;
  /** PNG with transparency, any size (it is resized to the image). */
  markupBase64: string;
  qualityCheck?: boolean;
}): Promise<Generation> {
  const batchId = crypto.randomUUID();
  try {
    const prepared = await prepareInputs(input.image, input.markupBase64);
    const result = await editWithMarkup({
      image: prepared.image,
      markupBase64: prepared.markupBase64,
      prompt: wrapPrompt(input.prompt),
      tier: input.tier,
      complexity: input.complexity,
    });
    const quality =
      input.qualityCheck === false
        ? null
        : await judgeImage({
            image: { base64: result.imageBase64, mimeType: result.mimeType },
            brief: `Markup edit. Requested change: ${input.prompt}. Everything outside the marked areas must stay the same as the original.`,
            expectedText: quotedText(input.prompt),
            references: [{ ...prepared.image, role: "original" }],
          });
    const imageUrl = await uploadGeneratedImage(input.brandId, "markup_edit", result.imageBase64, result.mimeType);
    return await insertGeneration({
      brand_id: input.brandId,
      batch_id: batchId,
      track: "markup_edit",
      placement: "markup_edit",
      model_used: result.modelUsed,
      prompt_used: input.prompt,
      image_url: imageUrl,
      est_cost_usd: result.estCostUsd,
      status: "complete",
      ...(quality ? { quality_score: quality.score, quality_notes: qualityNote(quality), quality_attempts: 1 } : {}),
    });
  } catch (err) {
    return insertGeneration({
      brand_id: input.brandId,
      batch_id: batchId,
      track: "markup_edit",
      placement: "markup_edit",
      prompt_used: input.prompt,
      status: "failed",
      error_message: err instanceof Error ? err.message : "Unknown error",
    });
  }
}
