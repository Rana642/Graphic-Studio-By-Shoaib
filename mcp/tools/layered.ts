import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getBrand } from "../../lib/brands.js";
import { getPlacement, PLACEMENTS } from "../../lib/placements.js";
import { composeLayered, type BrandStyle } from "../../lib/layered/compose.js";
import { PRESETS, type Preset } from "../../lib/layered/layouts.js";
import { recomposeLayered, runExactTextGeneration } from "../../lib/layered/generate.js";
import { PROVIDERS, COMPLEXITIES, type Provider, type Complexity } from "../../lib/image-providers/types.js";

const HEX = /^#[0-9a-fA-F]{6}$/;

export function registerLayeredTools(server: McpServer): void {
  server.registerTool(
    "studio_layered_compose",
    {
      title: "Exact-Text Design (compose text on a background)",
      description: `Puts exact text on a background image: a badge label, a headline (at most two lines, fitted to a readable size), a CTA button and the logo, in real fonts. The words are typed by you, never drawn by an AI model, so the spelling is always right, and changing a word later costs nothing.

Use it with a text-free background (from studio_generate_from_prompt with a "no text, leave a calm empty area on the left" brief, or any image). Free: no AI call, no spend.

Args:
  - backgroundPath (string, required): local path to the background (png/jpg/webp).
  - hook (string, required): the headline.
  - label (string, optional): small badge text above the headline, e.g. "FREE AUDIT".
  - cta (string, optional): call-to-action button text.
  - brandId (string, UUID, optional): takes the brand's colours, font (Archivo or Inter are bundled; anything else falls back, with a note) and logo. Without it, give primaryColor / accentColor and logoPath.
  - primaryColor, accentColor (strings "#rrggbb", optional): CTA button colour and badge colour when no brandId is given.
  - phone, email, website (strings, optional): when any is given, a thin footer contact strip is drawn (edge to edge, brand colour, outline icons) and the layout keeps clear of it. Copy them from the brand's official website, never from an old creative.
  - logoPath (string, optional): a logo file (png/jpg/svg) to use instead of the brand's. Pick the light-on-dark or dark-on-light variant that suits the background.
  - placementId (string, optional): a placement id from studio_list_placements; the background is cropped to fill that size. Without it the background's own size is used.
  - preset ("auto" | "left" | "center" | "bottom", default "auto"): auto tries all three and keeps the one whose text reads best on this background.
  - outPath (string, optional): where to save the PNG (default: next to the background, "<name>_layered.png"). A ".layout.json" with the text, fonts and positions is saved beside it.

Returns the file paths and a report: preset used, headline size and lines, text colour, the worst-case contrast behind the headline (needs 3:1) and any notes (e.g. headline too long, background too busy).`,
      inputSchema: {
        backgroundPath: z.string().min(1).describe("Local path to the background image"),
        hook: z.string().min(1).max(200).describe("The headline"),
        label: z.string().max(60).optional().describe("Badge text"),
        cta: z.string().max(60).optional().describe("CTA button text"),
        brandId: z.string().uuid().optional().describe("Brand to take colours, font and logo from"),
        primaryColor: z.string().regex(HEX).optional().describe("CTA colour, #rrggbb"),
        phone: z.string().max(60).optional().describe("Phone for the footer contact strip"),
        email: z.string().max(120).optional().describe("Email for the footer contact strip"),
        website: z.string().max(120).optional().describe("Website for the footer contact strip"),
        accentColor: z.string().regex(HEX).optional().describe("Badge colour, #rrggbb"),
        logoPath: z.string().min(1).optional().describe("Local logo file (png/jpg/svg)"),
        placementId: z.string().optional().describe("Placement id from studio_list_placements"),
        preset: z.enum(["auto", ...PRESETS]).default("auto").describe("Layout preset"),
        outPath: z.string().min(1).optional().describe("Output PNG path"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (p: {
      backgroundPath: string;
      hook: string;
      label?: string;
      cta?: string;
      brandId?: string;
      primaryColor?: string;
      accentColor?: string;
      phone?: string;
      email?: string;
      website?: string;
      logoPath?: string;
      placementId?: string;
      preset: Preset | "auto";
      outPath?: string;
    }) => {
      const fail = (text: string) => ({ content: [{ type: "text" as const, text: `Error: ${text}` }], isError: true });
      try {
        const background = await readFile(p.backgroundPath);
        const meta = await sharp(background).metadata();
        let width = meta.width ?? 0;
        let height = meta.height ?? 0;
        if (p.placementId) {
          const placement = getPlacement(p.placementId);
          if (!placement) return fail(`unknown placementId '${p.placementId}'. Valid: ${PLACEMENTS.map((x) => x.id).join(", ")}.`);
          width = placement.width;
          height = placement.height;
        }
        if (!width || !height) return fail("couldn't read the background's size.");

        let brand: BrandStyle = { name: "", primary_hex: p.primaryColor ?? "#0f0f14", accent_hex: p.accentColor ?? null };
        let logo: Buffer | null = p.logoPath ? await readFile(p.logoPath) : null;
        if (p.brandId) {
          const b = await getBrand(p.brandId);
          if (!b) return fail(`no brand found with id '${p.brandId}'.`);
          brand = { name: b.name, primary_hex: p.primaryColor ?? b.primary_hex, accent_hex: p.accentColor ?? b.accent_hex, font_family: b.font_family };
          if (!logo && b.logo_url) {
            const res = await fetch(b.logo_url);
            if (res.ok) logo = Buffer.from(await res.arrayBuffer());
          }
        }

        const r = await composeLayered({
          background,
          width,
          height,
          content: { hook: p.hook, label: p.label, cta: p.cta },
          brand,
          logo,
          preset: p.preset,
          contact: p.phone || p.email || p.website ? { phone: p.phone, email: p.email, website: p.website } : null,
        });

        const out = p.outPath ?? path.join(path.dirname(p.backgroundPath), `${path.basename(p.backgroundPath, path.extname(p.backgroundPath))}_layered.png`);
        const layoutPath = out.replace(/\.png$/i, "") + ".layout.json";
        await writeFile(out, r.png);
        await writeFile(layoutPath, JSON.stringify(r.layoutJson, null, 2));

        const rep = r.report;
        const text = `# Exact-text design\n\n- Image: ${out} (${width}x${height})\n- Layout file: ${layoutPath}\n- Preset: ${rep.preset}, headline ${rep.hookFontSize}px, ${rep.hookLines.length} line(s)\n- Text colour ${rep.textColor}, worst-case contrast ${rep.contrast}:1 ${rep.contrastPass ? "(pass)" : "(FAIL: needs 3:1)"}${rep.notes.length ? `\n- Notes:\n${rep.notes.map((n) => `  - ${n}`).join("\n")}` : ""}`;
        return { content: [{ type: "text" as const, text }], structuredContent: { image: out, layout: layoutPath, report: rep } };
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    }
  );

  server.registerTool(
    "studio_generate_exact_text",
    {
      title: "Generate Exact-Text Brand Graphics",
      description: `Like studio_generate_graphics, but the AI draws only a TEXT-FREE background and the words, badge, CTA button and logo are composed on top in real fonts. The spelling is always exactly what you pass, and the text can be changed later for free with studio_recompose_text.

Costs money for the background only (one image per placement). Delivery is instant (no Batch).

Args:
  - brandId (string, UUID): from studio_list_brands.
  - offer (string, 1-500 chars): the campaign in a sentence (guides the background scene).
  - copyLabel / copyHook / copyCta (strings): the exact badge text, headline (max two lines) and button text.
  - provider ("nano-banana" | "gpt-image" | "flux"), tier ("draft" | "standard" | "premium"), placementIds (1-6 from studio_list_placements).
  - complexity ("low" | "medium" | "high", optional): GPT Image 2.6 only.
  - contactStrip (boolean, optional): add the thin footer strip with the brand's saved phone, email and website.

Sizes of a similar shape share ONE background (e.g. Story + Feed), so asking for several sizes costs less than one image each; only the first row of a group carries the cost.

Needs the "Exact text" SQL from supabase-schema.sql to have been run. Returns, per placement, the image URL (the finished design) and the row id (needed for studio_recompose_text).`,
      inputSchema: {
        brandId: z.string().uuid(),
        offer: z.string().min(1).max(500),
        copyLabel: z.string().min(1).max(60),
        copyHook: z.string().min(1).max(200),
        copyCta: z.string().min(1).max(60),
        provider: z.enum(PROVIDERS),
        tier: z.enum(["draft", "standard", "premium"]),
        placementIds: z.array(z.string()).min(1).max(6),
        complexity: z.enum(COMPLEXITIES).optional(),
        contactStrip: z.boolean().optional().describe("Draw the footer contact strip from the brand's phone, email and website"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (p: { brandId: string; offer: string; copyLabel: string; copyHook: string; copyCta: string; provider: Provider; tier: "draft" | "standard" | "premium"; placementIds: string[]; complexity?: Complexity; contactStrip?: boolean }) => {
      const fail = (text: string) => ({ content: [{ type: "text" as const, text: `Error: ${text}` }], isError: true });
      try {
        const placements = p.placementIds.map(getPlacement).filter((x) => x !== undefined);
        if (placements.length === 0) return fail("no valid placementIds. Call studio_list_placements for valid ids.");
        const { batchId, results } = await runExactTextGeneration({
          brandId: p.brandId,
          offer: p.offer,
          copy: { label: p.copyLabel, hook: p.copyHook, cta: p.copyCta },
          provider: p.provider,
          tier: p.tier,
          placements,
          complexity: p.complexity,
          contactStrip: p.contactStrip,
        });
        const lines = results.map((r) => (r.status === "complete" ? `- ✅ **${r.placement}** — ${r.image_url} (row ${r.id}, est. $${r.est_cost_usd})` : `- ❌ **${r.placement}** — ${r.error_message}`));
        return {
          content: [{ type: "text" as const, text: `# Exact-text batch ${batchId}\n\n${lines.join("\n")}` }],
          structuredContent: { batchId, results: results.map((r) => ({ id: r.id, placement: r.placement, status: r.status, image_url: r.image_url, background_url: r.background_url ?? null, est_cost_usd: r.est_cost_usd, error_message: r.error_message })) },
        };
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    }
  );

  server.registerTool(
    "studio_recompose_text",
    {
      title: "Change the Text on an Exact-Text Design",
      description: `Changes the words on a saved exact-text design (made by studio_generate_exact_text or the Generate page's "Exact text" option): same background, same layout, new text. FREE and instant: no AI call. An enhanced (upscaled) copy is cleared, because it no longer matches.

Args:
  - generationId (string, UUID): the row id of the design.
  - label / hook / cta (strings, all optional): only what you pass changes; an empty string clears the badge or the button.

Returns the new image URL.`,
      inputSchema: {
        generationId: z.string().uuid(),
        label: z.string().max(60).optional(),
        hook: z.string().min(1).max(200).optional(),
        cta: z.string().max(60).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (p: { generationId: string; label?: string; hook?: string; cta?: string }) => {
      try {
        const row = await recomposeLayered(p);
        return { content: [{ type: "text" as const, text: `Text changed: ${row.image_url}` }], structuredContent: { id: row.id, image_url: row.image_url } };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
