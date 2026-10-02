import { z } from "zod";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getBrand } from "../../lib/brands.js";
import { PLACEMENTS, getPlacement } from "../../lib/placements.js";
import { listGenerations, type Generation } from "../../lib/generations.js";
import { loadReferenceImagesAsBase64 } from "../../lib/references.js";
import { buildImagePrompt, buildSubjectEditPrompt } from "../../lib/prompt.js";
import { runGenerationBatch } from "../../lib/generate-batch.js";
import { syncBatchJobs } from "../../lib/batch-jobs.js";
import { autoRetouchPhoto } from "../../lib/retouch.js";

function formatError(error: unknown): string {
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Reads local image files off disk for use as ad-hoc reference images —
 *  the MCP equivalent of the web form's file picker. Throws with the exact
 *  path on a read failure rather than silently dropping it, so a typo'd
 *  path surfaces clearly instead of just generating without that style
 *  reference. */
async function loadLocalReferenceImages(
  paths: string[]
): Promise<{ base64: string; mimeType: string }[]> {
  return Promise.all(
    paths.map(async (filePath) => {
      const mimeType = MIME_BY_EXT[extname(filePath).toLowerCase()] ?? "image/png";
      let buffer: Buffer;
      try {
        buffer = await readFile(filePath);
      } catch (err) {
        throw new Error(
          `Could not read reference image at '${filePath}': ${err instanceof Error ? err.message : String(err)}`
        );
      }
      return { base64: buffer.toString("base64"), mimeType };
    })
  );
}

function resultsToMarkdown(batchId: string, results: Generation[]): string {
  const lines = [`# Batch ${batchId}`, ""];
  for (const r of results) {
    lines.push(
      r.status === "complete"
        ? `- ✅ **${r.placement}** — ${r.image_url}`
        : r.status === "pending"
          ? `- ⏳ **${r.placement}** — queued in the batch (half price, ready within 24 h)`
          : `- ❌ **${r.placement}** — ${r.error_message}`
    );
  }
  if (results.some((r) => r.status === "pending")) {
    lines.push("", "Call studio_check_batches with this batchId later to collect the images.");
  }
  return lines.join("\n");
}

function resultsToStructured(batchId: string, results: Generation[]) {
  return {
    batchId,
    results: results.map((r) => ({
      placement: r.placement,
      status: r.status,
      delivery: r.delivery,
      image_url: r.image_url,
      model_used: r.model_used,
      est_cost_usd: r.est_cost_usd,
      error_message: r.error_message,
    })),
  };
}

export function registerGenerationTools(server: McpServer): void {
  server.registerTool(
    "studio_list_placements",
    {
      title: "List Graphic Placements",
      description: `List every output placement (social/ad size) the studio can generate — the exact ids to pass in placementIds when calling studio_generate_graphics or studio_generate_from_prompt.

Returns (JSON): { "placements": [{ "id", "label", "width", "height" }] }`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const placements = PLACEMENTS.map((p) => ({
        id: p.id,
        label: p.label,
        width: p.width,
        height: p.height,
      }));
      const lines = [
        "# Available placements",
        "",
        ...placements.map((p) => `- \`${p.id}\` — ${p.label} (${p.width}×${p.height})`),
      ];
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: { placements },
      };
    }
  );

  server.registerTool(
    "studio_generate_graphics",
    {
      title: "Generate Brand Graphics",
      description: `Generate on-brand marketing graphics for one or more placements (sizes) in a single batch, using the brand's locked color palette, voice, and any uploaded reference images for style consistency.

This is the Creative Track: a text-to-image AI model draws the entire graphic, including the label/hook/CTA text baked into the image. Write the copy yourself (label/hook/cta) before calling this — the tool does not generate copy, it only renders it into the graphic. For a graphic that isn't scoped to any brand's identity, use studio_generate_from_prompt instead.

Args:
  - brandId (string, UUID, required): from studio_list_brands.
  - copyLabel (string, required): small badge text near the top, e.g. "NEW ARRIVAL". Keep to ~3 words — it gets printed directly onto the image.
  - copyHook (string, required): the bold main headline, centered. Keep to ~6 words.
  - copyCta (string, required): call-to-action inside a button shape near the bottom, e.g. "Shop Now". Keep to ~3 words.
  - provider ("nano-banana" | "gpt-image", required): which image model family to use.
  - tier ("draft" | "standard" | "premium", required): quality/cost tier — draft is cheapest for concepting, premium is the best-quality final export.
  - placementIds (string[], required, 1-6 items): placement ids from studio_list_placements, e.g. ["ig_feed", "ig_story"]. One image is generated per placement, in parallel, sharing the same batch.
  - delivery ("instant" | "batch", optional, default "instant"): "batch" sends the job through the provider's Batch API — same model and quality at 50% of the price, ready within 24 hours. Batch results come back with status "pending"; collect them later with studio_check_batches. Use batch whenever the images aren't needed right away.

Returns (JSON):
{
  "batchId": string,
  "results": [
    { "placement": string, "status": "complete"|"failed"|"pending", "delivery": "instant"|"batch", "image_url": string|null, "model_used": string|null, "est_cost_usd": number|null, "error_message": string|null }
  ]
}
A "complete" result's image_url is a public URL — download it (e.g. with curl) to use the graphic elsewhere. A "failed" result carries error_message explaining why that one placement didn't render; other placements in the same batch are unaffected.

Error Handling:
  - Returns an error if brandId doesn't match any brand, or if none of placementIds are valid.
  - Individual placement failures (bad API response, model error) do not fail the whole call — check each result's status.`,
      inputSchema: {
        brandId: z.string().uuid().describe("Brand id (UUID), from studio_list_brands"),
        copyLabel: z.string().min(1).max(60).describe('Small badge text near the top, e.g. "NEW ARRIVAL"'),
        copyHook: z.string().min(1).max(200).describe("Bold main headline, centered"),
        copyCta: z.string().min(1).max(60).describe('Call-to-action button text, e.g. "Shop Now"'),
        provider: z.enum(["nano-banana", "gpt-image"]).describe("Image model family to use"),
        tier: z.enum(["draft", "standard", "premium"]).describe("Quality/cost tier"),
        placementIds: z
          .array(z.string())
          .min(1)
          .max(6)
          .describe("Placement ids from studio_list_placements, e.g. [\"ig_feed\", \"ig_story\"]"),
        delivery: z
          .enum(["instant", "batch"])
          .default("instant")
          .describe('"instant" = normal price, images now. "batch" = provider Batch API, 50% cheaper, ready within 24 h — results come back "pending"; collect them with studio_check_batches.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: {
      brandId: string;
      copyLabel: string;
      copyHook: string;
      copyCta: string;
      provider: "nano-banana" | "gpt-image";
      tier: "draft" | "standard" | "premium";
      placementIds: string[];
      delivery: "instant" | "batch";
    }) => {
      try {
        const brand = await getBrand(params.brandId);
        if (!brand) {
          return {
            content: [{ type: "text", text: `Error: No brand found with id '${params.brandId}'.` }],
            isError: true,
          };
        }

        const placements = params.placementIds.map(getPlacement).filter((p) => p !== undefined);
        if (placements.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "Error: No valid placements in placementIds. Call studio_list_placements for valid ids.",
              },
            ],
            isError: true,
          };
        }

        const copy = { label: params.copyLabel, hook: params.copyHook, cta: params.copyCta };
        const colors = [brand.primary_hex, brand.secondary_hex, brand.accent_hex].filter(
          (c): c is string => Boolean(c)
        );
        const prompt = buildImagePrompt(brand, colors, copy);
        const referenceImages = await loadReferenceImagesAsBase64(params.brandId);

        const { batchId, results } = await runGenerationBatch({
          brandId: params.brandId,
          prompt,
          provider: params.provider,
          tier: params.tier,
          placements,
          referenceImages,
          copy,
          delivery: params.delivery,
        });

        return {
          content: [{ type: "text", text: resultsToMarkdown(batchId, results) }],
          structuredContent: resultsToStructured(batchId, results),
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  server.registerTool(
    "studio_generate_from_prompt",
    {
      title: "Generate Graphics From a Free Prompt",
      description: `Generate graphics for one or more placements from a prompt you write yourself — no brand required. Unlike studio_generate_graphics, nothing is added on top of your prompt: no brand colors/voice, no label/hook/cta scaffolding. Write the complete creative brief (layout, text to render, colors, mood) in the prompt itself.

Args:
  - prompt (string, required, 1-2000 chars): the full creative brief — describe everything that should appear in the image, including any text to render (spell it out exactly as it should appear).
  - provider ("nano-banana" | "gpt-image", required): which image model family to use.
  - tier ("draft" | "standard" | "premium", required): quality/cost tier.
  - placementIds (string[], required, 1-6 items): placement ids from studio_list_placements. One image is generated per placement, in parallel, sharing the same batch.
  - brandId (string, UUID, optional): purely for filing/history and to pull that brand's reference images in for style consistency — does NOT inject that brand's colors, voice, or footer into the prompt. Omit for a fully standalone generation.
  - referenceImagePaths (string[], optional, up to 4): local filesystem paths to images (png/jpg/webp/gif) to send alongside the prompt for style matching — e.g. an existing graphic to mimic the layout/palette of. Combined with the brand's saved reference images if brandId is also given.

  - delivery ("instant" | "batch", optional): as in studio_generate_graphics — "batch" is 50% cheaper, ready within 24 h, collect with studio_check_batches.

Returns (JSON): same shape as studio_generate_graphics — { "batchId", "results": [{ "placement", "status", "image_url", "model_used", "est_cost_usd", "error_message" }] }.

Error Handling:
  - Returns an error if brandId is given but doesn't match any brand, if a referenceImagePaths entry can't be read, or if none of placementIds are valid.
  - Individual placement failures do not fail the whole call — check each result's status.`,
      inputSchema: {
        prompt: z
          .string()
          .min(1)
          .max(2000)
          .describe("Full creative brief — everything to render, spelled out exactly"),
        provider: z.enum(["nano-banana", "gpt-image"]).describe("Image model family to use"),
        tier: z.enum(["draft", "standard", "premium"]).describe("Quality/cost tier"),
        placementIds: z
          .array(z.string())
          .min(1)
          .max(6)
          .describe("Placement ids from studio_list_placements"),
        brandId: z
          .string()
          .uuid()
          .optional()
          .describe("Optional: file under this brand + use its reference images. Does not affect the prompt."),
        referenceImagePaths: z
          .array(z.string())
          .max(4)
          .optional()
          .describe("Local file paths to images for style/reference input, e.g. an existing graphic to match"),
        delivery: z
          .enum(["instant", "batch"])
          .default("instant")
          .describe('"instant" = normal price, images now. "batch" = provider Batch API, 50% cheaper, ready within 24 h — results come back "pending"; collect them with studio_check_batches.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: {
      prompt: string;
      provider: "nano-banana" | "gpt-image";
      tier: "draft" | "standard" | "premium";
      placementIds: string[];
      brandId?: string;
      referenceImagePaths?: string[];
      delivery: "instant" | "batch";
    }) => {
      try {
        const placements = params.placementIds.map(getPlacement).filter((p) => p !== undefined);
        if (placements.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "Error: No valid placements in placementIds. Call studio_list_placements for valid ids.",
              },
            ],
            isError: true,
          };
        }

        let brandReferenceImages: { base64: string; mimeType: string }[] = [];
        if (params.brandId) {
          const brand = await getBrand(params.brandId);
          if (!brand) {
            return {
              content: [{ type: "text", text: `Error: No brand found with id '${params.brandId}'.` }],
              isError: true,
            };
          }
          brandReferenceImages = await loadReferenceImagesAsBase64(params.brandId);
        }

        let localReferenceImages: { base64: string; mimeType: string }[] = [];
        if (params.referenceImagePaths && params.referenceImagePaths.length > 0) {
          try {
            localReferenceImages = await loadLocalReferenceImages(params.referenceImagePaths);
          } catch (err) {
            return { content: [{ type: "text", text: formatError(err) }], isError: true };
          }
        }
        const referenceImages = [...localReferenceImages, ...brandReferenceImages];

        const { batchId, results } = await runGenerationBatch({
          brandId: params.brandId ?? null,
          prompt: params.prompt,
          provider: params.provider,
          tier: params.tier,
          placements,
          referenceImages,
          delivery: params.delivery,
        });

        return {
          content: [{ type: "text", text: resultsToMarkdown(batchId, results) }],
          structuredContent: resultsToStructured(batchId, results),
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  server.registerTool(
    "studio_generate_subject_edit",
    {
      title: "Generate a Scene Around a Real Subject",
      description: `Subject-Preserving Edit track: keep a real photo's subject (a person or a product) visually unchanged while the AI generates a brand-new scene/background around them. Use this instead of studio_generate_from_prompt whenever the photo shows something real that must not be redrawn — a salon client's actual haircut result, a real product shot — vs. a purely creative graphic where nothing real needs preserving.

This is near-perfect fidelity, not guaranteed pixel-perfect (it's still an AI edit, not deterministic compositing) — the subject should come through visually identical, but expect some risk at the edges/lighting blend compared to a fully locked composite.

Args:
  - subjectImagePath (string, required): local file path to the real photo (person or product) to preserve.
  - sceneDescription (string, required, 1-1000 chars): describe ONLY the new background/scene/mood — do not describe the subject, it's taken from the photo as-is.
  - provider ("nano-banana" | "gpt-image", required): which image model family to use.
  - tier ("draft" | "standard" | "premium", required): quality/cost tier.
  - placementIds (string[], required, 1-6 items): placement ids from studio_list_placements.
  - brandId (string, UUID, optional): files the result under that brand's history only — has no effect on the prompt.

  - delivery ("instant" | "batch", optional): as in studio_generate_graphics — "batch" is 50% cheaper, ready within 24 h, collect with studio_check_batches.

Returns (JSON): same shape as studio_generate_graphics — { "batchId", "results": [{ "placement", "status", "image_url", "model_used", "est_cost_usd", "error_message" }] }.

Error Handling:
  - Returns an error if subjectImagePath can't be read, brandId is given but doesn't match any brand, or none of placementIds are valid.
  - Individual placement failures do not fail the whole call — check each result's status.`,
      inputSchema: {
        subjectImagePath: z.string().describe("Local file path to the real person/product photo to preserve"),
        sceneDescription: z
          .string()
          .min(1)
          .max(1000)
          .describe("Describe only the new background/scene — not the subject"),
        provider: z.enum(["nano-banana", "gpt-image"]).describe("Image model family to use"),
        tier: z.enum(["draft", "standard", "premium"]).describe("Quality/cost tier"),
        placementIds: z
          .array(z.string())
          .min(1)
          .max(6)
          .describe("Placement ids from studio_list_placements"),
        brandId: z
          .string()
          .uuid()
          .optional()
          .describe("Optional: file under this brand's history. Does not affect the prompt."),
        delivery: z
          .enum(["instant", "batch"])
          .default("instant")
          .describe('"instant" = normal price, images now. "batch" = provider Batch API, 50% cheaper, ready within 24 h — results come back "pending"; collect them with studio_check_batches.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: {
      subjectImagePath: string;
      sceneDescription: string;
      provider: "nano-banana" | "gpt-image";
      tier: "draft" | "standard" | "premium";
      placementIds: string[];
      brandId?: string;
      delivery: "instant" | "batch";
    }) => {
      try {
        const placements = params.placementIds.map(getPlacement).filter((p) => p !== undefined);
        if (placements.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "Error: No valid placements in placementIds. Call studio_list_placements for valid ids.",
              },
            ],
            isError: true,
          };
        }

        if (params.brandId) {
          const brand = await getBrand(params.brandId);
          if (!brand) {
            return {
              content: [{ type: "text", text: `Error: No brand found with id '${params.brandId}'.` }],
              isError: true,
            };
          }
        }

        let subjectImage: { base64: string; mimeType: string };
        try {
          [subjectImage] = await loadLocalReferenceImages([params.subjectImagePath]);
        } catch (err) {
          return { content: [{ type: "text", text: formatError(err) }], isError: true };
        }

        const prompt = buildSubjectEditPrompt(params.sceneDescription);

        // Deterministic exposure/contrast correction before the AI ever
        // sees the subject — see lib/retouch.ts.
        const retouchedBuffer = await autoRetouchPhoto(Buffer.from(subjectImage.base64, "base64"));
        const retouchedSubjectImage = { base64: retouchedBuffer.toString("base64"), mimeType: "image/png" };

        const { batchId, results } = await runGenerationBatch({
          brandId: params.brandId ?? null,
          prompt,
          provider: params.provider,
          tier: params.tier,
          placements,
          referenceImages: [retouchedSubjectImage],
          track: "subject_edit",
          delivery: params.delivery,
        });

        return {
          content: [{ type: "text", text: resultsToMarkdown(batchId, results) }],
          structuredContent: resultsToStructured(batchId, results),
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  server.registerTool(
    "studio_check_batches",
    {
      title: "Check Batch Generations",
      description: `Check OpenAI's and Google's Batch API for every generation queued with delivery "batch", save whatever has finished, and report it. Batch images are 50% cheaper and arrive within 24 hours; nothing collects them automatically — the app's Batches page and this tool are what bring them in.

Args:
  - batchId (string, optional): only report this batch (as returned by a generate tool). Every pending job is still checked.

Returns (JSON): { "sync": { "jobsChecked", "stillRunning", "completed", "failed", "errors": string[] }, "results": [{ "batchId", "placement", "status", "image_url", "error_message" }] }
results lists the given batch, or — without batchId — every batch row still pending plus those finished in the last 24 hours. A "complete" image_url is public; download it to reuse the graphic.`,
      inputSchema: {
        batchId: z.string().optional().describe("Only report this batch id"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ batchId }: { batchId?: string }) => {
      try {
        const sync = await syncBatchJobs();
        const rows = (await listGenerations({ batchId, limit: 100 })).filter(
          (g) =>
            g.delivery === "batch" &&
            (batchId || g.status === "pending" || Date.now() - Date.parse(g.completed_at ?? g.created_at) < 24 * 60 * 60 * 1000)
        );

        const lines = [
          `# Batch check — ${sync.jobsChecked} job(s) checked`,
          `Saved now: ${sync.completed} · failed now: ${sync.failed} · still running: ${sync.stillRunning}`,
          ...sync.errors.map((e) => `⚠️ ${e}`),
          "",
        ];
        for (const g of rows) {
          lines.push(
            g.status === "complete"
              ? `- ✅ **${g.placement}** (batch ${g.batch_id}) — ${g.image_url}`
              : g.status === "pending"
                ? `- ⏳ **${g.placement}** (batch ${g.batch_id}) — still in the provider's queue`
                : `- ❌ **${g.placement}** (batch ${g.batch_id}) — ${g.error_message}`
          );
        }
        if (rows.length === 0) lines.push("_No batch generations to report._");

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: {
            sync,
            results: rows.map((g) => ({
              batchId: g.batch_id,
              placement: g.placement,
              status: g.status,
              image_url: g.image_url,
              error_message: g.error_message,
            })),
          },
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  server.registerTool(
    "studio_list_generations",
    {
      title: "List Generation Results",
      description: `List past generated graphics, most recent first — including the public image_url for each one, so a completed graphic can be downloaded and reused (e.g. dropped into another project's public/images folder).

Args:
  - brandId (string, UUID, optional): filter to one brand's generations (from studio_list_brands). Omit to list across every brand, including standalone free-prompt generations with no brand.
  - batchId (string, optional): filter to one batch (as returned by studio_generate_graphics / studio_generate_from_prompt).
  - status ("pending"|"complete"|"failed", optional): filter by status.
  - limit (number, optional, 1-100, default 50): max rows to return, most recent first.

Returns (JSON): { "count": number, "generations": [{ "id", "brand_id", "batch_id", "placement", "status", "image_url", "model_used", "copy_label", "copy_hook", "copy_cta", "est_cost_usd", "error_message", "created_at" }] }
A null brand_id means that generation came from studio_generate_from_prompt with no brandId.`,
      inputSchema: {
        brandId: z
          .string()
          .uuid()
          .optional()
          .describe("Filter to one brand. Omit to list across every brand + standalone generations."),
        batchId: z.string().optional().describe("Filter to one batch id"),
        status: z.enum(["pending", "complete", "failed"]).optional().describe("Filter by status"),
        limit: z.number().int().min(1).max(100).default(50).describe("Max rows to return"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({
      brandId,
      batchId,
      status,
      limit,
    }: {
      brandId?: string;
      batchId?: string;
      status?: "pending" | "complete" | "failed";
      limit: number;
    }) => {
      try {
        const generations = await listGenerations({ brandId, batchId, status, limit });

        const lines = [`# Generations (${generations.length})`, ""];
        for (const g of generations) {
          lines.push(
            g.status === "complete"
              ? `- ✅ **${g.placement}** (batch ${g.batch_id}) — ${g.image_url}`
              : `- ${g.status === "failed" ? "❌" : "⏳"} **${g.placement}** (batch ${g.batch_id}) — ${
                  g.error_message ?? g.status
                }`
          );
        }
        if (generations.length === 0) lines.push("_No generations found for this filter._");

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: { count: generations.length, generations },
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );
}
