import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getBrand } from "../../lib/brands.js";
import { getPlacement, PLACEMENTS } from "../../lib/placements.js";
import { composeLayered, type BrandStyle } from "../../lib/layered/compose.js";
import { PRESETS, type Preset } from "../../lib/layered/layouts.js";

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
}
