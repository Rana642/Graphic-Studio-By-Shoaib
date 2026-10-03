import { z } from "zod";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PHOTOSHOOT_MODES, type PhotoshootModeId } from "../../lib/photoshoot-modes.js";
import { finalizeConcepts, listRecentPhotoshoots, runPhotoshoot } from "../../lib/photoshoot.js";
import type { Generation } from "../../lib/generations.js";

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

async function loadLocal(paths: string[]) {
  return Promise.all(
    paths.map(async (p) => {
      try {
        return { base64: (await readFile(p)).toString("base64"), mimeType: MIME[extname(p).toLowerCase()] ?? "image/png" };
      } catch (err) {
        throw new Error(`Could not read '${p}': ${err instanceof Error ? err.message : String(err)}`);
      }
    })
  );
}

const fail = (error: unknown) => ({ content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true });

const line = (r: Generation) =>
  r.status === "complete"
    ? `- ${r.id} — ${r.image_url}${r.quality_score != null ? ` (quality ${r.quality_score}/100${(r.quality_attempts ?? 1) > 1 ? ", auto-fixed once" : ""})` : ""}`
    : r.status === "pending"
      ? `- ${r.id} — ⏳ queued in the batch`
      : `- ${r.id} — ❌ ${r.error_message}`;

export function registerPhotoshootTools(server: McpServer): void {
  server.registerTool(
    "studio_list_photoshoot_modes",
    {
      title: "List Product Photoshoot Modes",
      description: `The ten Product Photoshoot modes (from Higgsfield's product-photoshoot skill) with their questions and allowed answers — the ids to pass to studio_photoshoot.

Returns (JSON): { "modes": [{ "id", "label", "short", "input": "product"|"source", "counts", "questions": [{ "id", "label", "options": [{ "value", "label" }] }] }] }`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const modes = PHOTOSHOOT_MODES.map(({ id, label, short, input, counts, questions }) => ({ id, label, short, input, counts, questions }));
      const text = modes
        .map((m) => `- \`${m.id}\` ${m.label} — ${m.short}. Counts ${m.counts.join("/")}. ${m.questions.map((q) => `${q.id}: ${q.options.map((o) => o.value).join("|")}`).join("; ")}`)
        .join("\n");
      return { content: [{ type: "text", text: `# Photoshoot modes\n\n${text}` }], structuredContent: { modes } };
    }
  );

  server.registerTool(
    "studio_photoshoot",
    {
      title: "Start a Product Photoshoot (Draft concepts)",
      description: `Step 1 of explore → approve → final: make cheap Draft concepts of a product in one of ten modes (studio shot, lifestyle, in hand, Pinterest pin, hero banner, carousel, ad pack, with a model, creative/CGI, restyle). Each variant differs in light, angle and palette; every image goes through the vision quality gate. Then let the user pick, and call studio_finalize_concepts with the chosen concept ids.

Args:
  - mode (required): a mode id from studio_list_photoshoot_modes.
  - imagePaths (string[], required, 1-3): local product photos (front/side/back) — or, for restyle, the image to restyle.
  - brandId (UUID, optional): adds the brand's colours, and its logo when there is text.
  - answers (object, optional): question id → option value (defaults to each question's first option).
  - note (string, optional): extra direction.
  - headline / cta (string, optional): text to put on the image (otherwise clean photos).
  - count (number, optional): one of the mode's counts.
  - provider ("gpt-image" | "nano-banana", default "gpt-image").
  - qualityCheck (boolean, default true).

Returns (JSON): { "batchId", "concepts": [{ "id", "placement", "status", "image_url", "quality_score", "quality_notes" }] }.`,
      inputSchema: {
        mode: z.enum(PHOTOSHOOT_MODES.map((m) => m.id) as [string, ...string[]]).describe("Photoshoot mode id"),
        imagePaths: z.array(z.string()).min(1).max(3).describe("Local product photo paths (or the image to restyle)"),
        brandId: z.string().uuid().optional(),
        answers: z.record(z.string(), z.string()).optional(),
        note: z.string().max(500).optional(),
        headline: z.string().max(120).optional(),
        cta: z.string().max(40).optional(),
        count: z.number().int().min(1).max(7).optional(),
        provider: z.enum(["gpt-image", "nano-banana"]).default("gpt-image"),
        qualityCheck: z.boolean().default(true),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (p: {
      mode: string;
      imagePaths: string[];
      brandId?: string;
      answers?: Record<string, string>;
      note?: string;
      headline?: string;
      cta?: string;
      count?: number;
      provider: "gpt-image" | "nano-banana";
      qualityCheck: boolean;
    }) => {
      try {
        const { batchId, results } = await runPhotoshoot({
          mode: p.mode as PhotoshootModeId,
          images: await loadLocal(p.imagePaths),
          brandId: p.brandId,
          answers: p.answers,
          note: p.note,
          text: p.headline || p.cta ? { headline: p.headline, cta: p.cta } : undefined,
          count: p.count,
          provider: p.provider,
          qualityCheck: p.qualityCheck,
        });
        return {
          content: [{ type: "text", text: `# Photoshoot ${batchId} — Draft concepts\n\n${results.map(line).join("\n")}\n\nAsk the user which to keep, then call studio_finalize_concepts with those ids.` }],
          structuredContent: {
            batchId,
            concepts: results.map((r) => ({ id: r.id, placement: r.placement, status: r.status, image_url: r.image_url, quality_score: r.quality_score ?? null, quality_notes: r.quality_notes ?? null })),
          },
        };
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "studio_list_photoshoots",
    {
      title: "List Recent Photoshoots",
      description: `Recent Product Photoshoots, newest first: each Draft concept (id, image, quality, approved or not) with any finals made from it. Use it to find concept ids for studio_finalize_concepts.

Args: limit (1-20, default 5).`,
      inputSchema: { limit: z.number().int().min(1).max(20).default(5) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ limit }: { limit: number }) => {
      try {
        const groups = await listRecentPhotoshoots(limit);
        const text = groups
          .map((g) => [`## ${g.mode} — ${g.createdAt.slice(0, 16)} (batch ${g.batchId})`, ...g.concepts.flatMap((c) => [`${line(c)}${c.approved_at ? " ✓ approved" : ""}`, ...c.finals.map((f) => `  final ${line(f).slice(2)}`)])].join("\n"))
          .join("\n\n");
        return { content: [{ type: "text", text: text || "_No photoshoots yet._" }], structuredContent: { photoshoots: groups } };
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "studio_finalize_concepts",
    {
      title: "Make Finals From Approved Concepts",
      description: `Step 3 of the photoshoot: re-create each chosen Draft concept at Standard or Premium quality — the concept is sent as image 1 so the composition, angle and text carry over, and the product photos follow for label fidelity. Marks the concepts approved. Each final goes through the quality gate.

Args:
  - conceptIds (UUID[], required, 1-10): from studio_photoshoot or studio_list_photoshoots.
  - tier ("standard" | "premium", required).
  - delivery ("instant" | "batch", default "instant"): batch is 50% cheaper and ready within 24 h (collect with studio_check_batches).
  - provider (optional): defaults to the concept's own model family.
  - qualityCheck (boolean, default true).

Returns (JSON): { "finals": [{ "id", "parent_generation_id", "status", "image_url", "quality_score", "quality_notes" }] }.`,
      inputSchema: {
        conceptIds: z.array(z.string().uuid()).min(1).max(10),
        tier: z.enum(["standard", "premium"]),
        delivery: z.enum(["instant", "batch"]).default("instant"),
        provider: z.enum(["gpt-image", "nano-banana"]).optional(),
        qualityCheck: z.boolean().default(true),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (p: { conceptIds: string[]; tier: "standard" | "premium"; delivery: "instant" | "batch"; provider?: "gpt-image" | "nano-banana"; qualityCheck: boolean }) => {
      try {
        const finals = await finalizeConcepts(p);
        return {
          content: [{ type: "text", text: `# Finals\n\n${finals.map(line).join("\n")}` }],
          structuredContent: {
            finals: finals.map((r) => ({
              id: r.id,
              parent_generation_id: (r as Generation & { parent_generation_id?: string }).parent_generation_id ?? null,
              status: r.status,
              image_url: r.image_url,
              quality_score: r.quality_score ?? null,
              quality_notes: r.quality_notes ?? null,
            })),
          },
        };
      } catch (error) {
        return fail(error);
      }
    }
  );
}
