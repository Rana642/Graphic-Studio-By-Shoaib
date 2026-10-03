import { z } from "zod";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getBrand } from "../../lib/brands.js";
import { PLACEMENTS, getPlacement } from "../../lib/placements.js";
import { getGeneration, listGenerations, recordQuality, type Generation } from "../../lib/generations.js";
import { loadBrandLogo, loadReferenceImagesAsBase64 } from "../../lib/references.js";
import { buildImageContract, buildSubjectEditContract } from "../../lib/prompt.js";
import { expectedTextFromPrompt, expectedTextOf, GLOBAL_DESIGN_RULE, quotedText, renderContract } from "../../lib/prompt-contract.js";
import { judgeImage, qualityNote, QUALITY_PASS_SCORE } from "../../lib/quality-gate.js";
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

/** Downloads an image link for the quality reviewer. */
async function fetchAsImage(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the image (${res.status}): ${url}`);
  return { base64: Buffer.from(await res.arrayBuffer()).toString("base64"), mimeType: (res.headers.get("content-type") || "image/png").split(";")[0] };
}

function resultsToMarkdown(batchId: string, results: Generation[]): string {
  const lines = [`# Batch ${batchId}`, ""];
  for (const r of results) {
    lines.push(
      r.status === "complete"
        ? `- ✅ **${r.placement}** — ${r.image_url}${qualityLine(r)}`
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

/** The quality gate's verdict, appended to a result line. */
function qualityLine(r: Generation): string {
  if (r.quality_score == null) return "";
  const retried = (r.quality_attempts ?? 1) > 1 ? ", auto-fixed once" : "";
  return ` (quality ${r.quality_score}/100${retried}${r.quality_score < 70 && r.quality_notes ? ` — ${r.quality_notes}` : ""})`;
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
      quality_score: r.quality_score ?? null,
      quality_notes: r.quality_notes ?? null,
      quality_attempts: r.quality_attempts ?? null,
    })),
  };
}

const QUALITY_SCHEMA = z
  .boolean()
  .default(true)
  .describe("Vision quality gate: an AI reviewer checks the text letter by letter, the logo/product and the design; a weak image is made once more with the fix (that retry costs one more image). Default true.");

const QUALITY_ARG_DOC = `  - qualityCheck (boolean, optional, default true): vision quality gate — each image is checked (exact text, logo/product fidelity, design rules) and a weak one is regenerated once with the reviewer's fix, keeping the better image. Each result then carries quality_score (0-100), quality_notes and quality_attempts. Batch images are scored but not regenerated.
`;

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
${QUALITY_ARG_DOC}
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
        qualityCheck: QUALITY_SCHEMA,
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
      qualityCheck: boolean;
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
        // Image 1 = the brand logo (when it has one), then its saved style references.
        const [logo, styleRefs] = await Promise.all([loadBrandLogo(brand.logo_url), loadReferenceImagesAsBase64(params.brandId)]);
        const referenceImages = [...(logo ? [logo] : []), ...styleRefs];
        const contract = buildImageContract(brand, colors, copy, { hasLogo: Boolean(logo), styleRefCount: styleRefs.length });
        const prompt = renderContract(contract);

        const { batchId, results } = await runGenerationBatch({
          brandId: params.brandId,
          prompt,
          provider: params.provider,
          tier: params.tier,
          placements,
          referenceImages,
          copy,
          delivery: params.delivery,
          contract,
          expectedText: expectedTextOf(contract),
          qualityCheck: params.qualityCheck,
          qualityRules: GLOBAL_DESIGN_RULE,
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
  - qualityCheck (boolean, optional, default true): vision quality gate, as in studio_generate_graphics.

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
        qualityCheck: QUALITY_SCHEMA,
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
      qualityCheck: boolean;
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
          expectedText: quotedText(params.prompt),
          qualityCheck: params.qualityCheck,
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
  - qualityCheck (boolean, optional, default true): vision quality gate, as in studio_generate_graphics.

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
        qualityCheck: QUALITY_SCHEMA,
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
      qualityCheck: boolean;
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

        const contract = buildSubjectEditContract(params.sceneDescription);
        const prompt = renderContract(contract);

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
          contract,
          expectedText: [],
          qualityCheck: params.qualityCheck,
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
    "studio_check_quality",
    {
      title: "Check an Image's Quality",
      description: `Run the vision quality gate on any image — a past generation, a local file or a public link — without generating anything. An AI reviewer (OpenAI gpt-5.4-mini) checks that every expected text line appears spelled exactly, flags invented or garbled words, compares the logo/product with their reference images, applies design rules (e.g. "light and glassy, no dark colours") and scores overall polish 0-100. Use it to QA graphics made elsewhere too (ChatGPT, scripts) before they are posted.

Args (give exactly one of generationId / imagePath / imageUrl):
  - generationId (UUID, optional): a studio generation — its expected text and design rule are read from its saved prompt; the score is saved on the row.
  - imagePath (string, optional): local image file.
  - imageUrl (string, optional): public https image link.
  - expectedText (string[], optional): exact lines the image must contain (overrides what the prompt implies).
  - rules (string, optional): design rules to judge against.
  - brief (string, optional): what the image is meant to show.
  - logoPath / productPath (string, optional): local reference images to compare against.

Returns (JSON): { "score", "passed", "text_ok", "wrong_text", "extra_text", "issues", "fix_hint", "judge" }. passed = score ≥ ${QUALITY_PASS_SCORE} and the text is right. Costs a fraction of a rupee per check; returns an error if no OPENAI_API_KEY is set.`,
      inputSchema: {
        generationId: z.string().uuid().optional().describe("A studio generation to check"),
        imagePath: z.string().optional().describe("Local image file to check"),
        imageUrl: z.string().url().optional().describe("Public https image link to check"),
        expectedText: z.array(z.string()).optional().describe("Exact lines the image must contain"),
        rules: z.string().optional().describe('Design rules, e.g. "light and glassy, no dark colours"'),
        brief: z.string().optional().describe("What the image is meant to show"),
        logoPath: z.string().optional().describe("Local logo file to compare with"),
        productPath: z.string().optional().describe("Local product photo to compare with"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: {
      generationId?: string;
      imagePath?: string;
      imageUrl?: string;
      expectedText?: string[];
      rules?: string;
      brief?: string;
      logoPath?: string;
      productPath?: string;
    }) => {
      try {
        const sources = [params.generationId, params.imagePath, params.imageUrl].filter(Boolean).length;
        if (sources !== 1) {
          return { content: [{ type: "text", text: "Error: give exactly one of generationId, imagePath or imageUrl." }], isError: true };
        }
        let image: { base64: string; mimeType: string };
        let prompt = "";
        let row: Generation | undefined;
        if (params.generationId) {
          row = (await getGeneration(params.generationId!)) ?? undefined;
          if (!row?.image_url) return { content: [{ type: "text", text: `Error: no finished generation '${params.generationId}'.` }], isError: true };
          image = await fetchAsImage(row.image_url);
          prompt = row.prompt_used ?? "";
        } else if (params.imagePath) {
          [image] = await loadLocalReferenceImages([params.imagePath]);
        } else {
          image = await fetchAsImage(params.imageUrl!);
        }
        const references = [
          ...(params.logoPath ? [{ ...(await loadLocalReferenceImages([params.logoPath]))[0], role: "logo" }] : []),
          ...(params.productPath ? [{ ...(await loadLocalReferenceImages([params.productPath]))[0], role: "product" }] : []),
        ];
        const result = await judgeImage({
          image,
          brief: params.brief ?? prompt,
          expectedText: params.expectedText ?? (prompt ? expectedTextFromPrompt(prompt) : []),
          rules: params.rules ?? (prompt.includes(GLOBAL_DESIGN_RULE) ? GLOBAL_DESIGN_RULE : undefined),
          references,
        });
        if (!result) {
          return { content: [{ type: "text", text: "Error: the quality check could not run (missing OPENAI_API_KEY or the reviewer failed)." }], isError: true };
        }
        if (row) await recordQuality(row.id, { score: result.score, notes: qualityNote(result) });
        const structured = {
          score: result.score,
          passed: result.passed,
          text_ok: result.textOk,
          wrong_text: result.wrongText,
          extra_text: result.extraText,
          issues: result.issues,
          fix_hint: result.fixHint,
          judge: result.judge,
        };
        const lines = [
          `# Quality ${result.score}/100 — ${result.passed ? "✅ passed" : "⚠️ needs work"}`,
          result.textOk ? "Text: all expected lines present." : `Text problems: ${result.wrongText.join(" | ")}`,
          result.extraText.length ? `Extra words: ${result.extraText.join(", ")}` : "",
          ...result.issues.map((i) => `- ${i}`),
          result.fixHint ? `Fix: ${result.fixHint}` : "",
        ].filter(Boolean);
        return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: structured };
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
