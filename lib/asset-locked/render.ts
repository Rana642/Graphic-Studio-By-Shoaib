import "server-only";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

// Resolved relative to this file, not process.cwd() — the MCP server can be
// launched from any directory (see mcp/index.ts's .env.local loading for
// the same reasoning), so cwd-based resolution would break there even
// though it happens to work for the Next.js app (always run from the repo
// root).
const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fonts");

const FONT_FILES = [
  path.join(FONTS_DIR, "NotoNastaliqUrdu.ttf"),
  path.join(FONTS_DIR, "Inter.ttf"),
];

/**
 * Renders a template's decorative/typography layer (the `frameSvg`) via
 * resvg-js — chosen over sharp's built-in librsvg rasterization because
 * resvg-js embeds font files directly (no system fontconfig dependency,
 * which librsvg needs and which serverless hosts like Vercel don't
 * configure for custom fonts by default) and has solid HarfBuzz-backed
 * shaping for complex scripts like Urdu Nastaliq. `frameSvg` should leave
 * the real photo's zone fully transparent (no fill) — this composites the
 * real, untouched photo underneath via `sharp`, so it's the only thing
 * that appears there.
 */
export async function renderTemplate(input: {
  frameSvg: string;
  photoBuffer: Buffer;
  canvasWidth: number;
  canvasHeight: number;
}): Promise<Buffer> {
  const framePng = new Resvg(input.frameSvg, {
    font: { loadSystemFonts: false, fontFiles: FONT_FILES },
    background: "rgba(0,0,0,0)",
  })
    .render()
    .asPng();

  const photoBase = await sharp(input.photoBuffer)
    .resize(input.canvasWidth, input.canvasHeight, { fit: "cover" })
    .png()
    .toBuffer();

  return sharp(photoBase)
    .composite([{ input: framePng, top: 0, left: 0 }])
    .png()
    .toBuffer();
}
