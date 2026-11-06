import { z } from "zod";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import sharp from "sharp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { COMPLEXITIES, type Complexity } from "../../lib/image-providers/types.js";
import { getBrand } from "../../lib/brands.js";
import { renderRegionsOverlay, runMarkupEdit, type MarkupRegion } from "../../lib/markup-edit.js";

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

const fraction = z.number().min(0).max(1);
const colorHex = z.string().regex(/^#[0-9a-fA-F]{6}$/).optional();

const regionSchema = z.discriminatedUnion("shape", [
  z.object({ shape: z.literal("rect"), x: fraction, y: fraction, w: fraction, h: fraction, color: colorHex }),
  z.object({ shape: z.literal("ellipse"), x: fraction, y: fraction, w: fraction, h: fraction, color: colorHex }),
  z.object({ shape: z.literal("arrow"), x: fraction, y: fraction, x2: fraction, y2: fraction, color: colorHex }),
]);

export function registerMarkupEditTools(server: McpServer): void {
  server.registerTool(
    "studio_markup_edit",
    {
      title: "Markup-Guided Image Edit",
      description: `Edit only the marked places of an existing image with GPT Image 2.6 (markup-guided edit). Everything outside the marks is kept as it is. Use it to fix one headline, one object or one area of a graphic or photo without regenerating the rest.

You say WHERE with either "regions" (the tool draws the marks for you) or "markupPath" (your own transparent PNG), and WHAT with "prompt".

Args:
  - imagePath (string, required): local path to the image to edit (png/jpg/webp).
  - prompt (string, required, 1-2000 chars): the change, e.g. 'Change the headline to "MODERN MEN CHOOSE BETTER"'. Put exact words in quotes: the quality check reads them letter by letter.
  - regions (array, optional): marks to draw, positions as fractions 0-1 of the image (x = left, y = top). { "shape": "rect" | "ellipse", "x", "y", "w", "h", "color"? } or { "shape": "arrow", "x", "y", "x2", "y2", "color"? } (the arrow points to x2,y2). color is "#rrggbb", default red.
  - markupPath (string, optional): a transparent PNG with the marks, used instead of regions; it is resized to the image if needed.
  Give regions or markupPath (one of them is required).
  - tier ("draft" | "standard" | "premium", default "standard"): draft = Flare low (cheapest), standard = Sunburst high, premium = Sunburst max.
  - complexity ("low" | "medium" | "high", default "low"): how much the model plans; low keeps an edit closest to the source. No extra fee.
  - brandId (string, UUID, optional): only files the result under that brand's history.
  - qualityCheck (boolean, default true): scores the result (exact words, rest unchanged). One image, no automatic retry.

Delivery is always instant: GPT Image 2.6 has no Batch API. Each call makes ONE image and costs money (about $0.006 draft, $0.05 standard, $0.21 premium).

Returns: the new image's public URL, model, estimated cost and quality score.`,
      inputSchema: {
        imagePath: z.string().min(1).describe("Local path to the image to edit"),
        prompt: z.string().min(1).max(2000).describe("What should change; exact words in quotes"),
        regions: z.array(regionSchema).min(1).max(20).optional().describe("Marks to draw (fractions of the image)"),
        markupPath: z.string().min(1).optional().describe("A transparent PNG with the marks, instead of regions"),
        tier: z.enum(["draft", "standard", "premium"]).default("standard").describe("Quality/cost tier"),
        complexity: z.enum(COMPLEXITIES).default("low").describe("Planning depth; low keeps edits closest to the source"),
        brandId: z.string().uuid().optional().describe("Optional: file under this brand"),
        qualityCheck: z.boolean().default(true).describe("Score the result"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: {
      imagePath: string;
      prompt: string;
      regions?: MarkupRegion[];
      markupPath?: string;
      tier: "draft" | "standard" | "premium";
      complexity: Complexity;
      brandId?: string;
      qualityCheck: boolean;
    }) => {
      const fail = (text: string) => ({ content: [{ type: "text" as const, text: `Error: ${text}` }], isError: true });
      try {
        if (!params.regions && !params.markupPath) return fail("give regions or markupPath, so the model knows where to edit.");
        const mimeType = MIME[extname(params.imagePath).toLowerCase()];
        if (!mimeType) return fail("imagePath must be a png, jpg or webp file.");
        if (params.brandId && !(await getBrand(params.brandId))) return fail(`no brand found with id '${params.brandId}'.`);

        const imageBuffer = await readFile(params.imagePath);
        let markupBuffer: Buffer;
        if (params.markupPath) {
          markupBuffer = await readFile(params.markupPath);
        } else {
          const meta = await sharp(imageBuffer).metadata();
          if (!meta.width || !meta.height) return fail("couldn't read the image size.");
          markupBuffer = await renderRegionsOverlay(meta.width, meta.height, params.regions ?? []);
        }

        const r = await runMarkupEdit({
          brandId: params.brandId ?? null,
          prompt: params.prompt,
          tier: params.tier,
          complexity: params.complexity,
          image: { base64: imageBuffer.toString("base64"), mimeType },
          markupBase64: markupBuffer.toString("base64"),
          qualityCheck: params.qualityCheck,
        });

        const text =
          r.status === "complete"
            ? `# Markup edit\n\n- ✅ ${r.image_url}\n- model: ${r.model_used}, est. cost $${r.est_cost_usd}${
                r.quality_score != null ? `\n- quality ${r.quality_score}/100${r.quality_score < 70 && r.quality_notes ? ` — ${r.quality_notes}` : ""}` : ""
              }`
            : `# Markup edit\n\n- ❌ ${r.error_message}`;
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            status: r.status,
            image_url: r.image_url,
            model_used: r.model_used,
            est_cost_usd: r.est_cost_usd,
            quality_score: r.quality_score ?? null,
            quality_notes: r.quality_notes ?? null,
            error_message: r.error_message,
          },
          ...(r.status === "failed" ? { isError: true } : {}),
        };
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    }
  );
}
