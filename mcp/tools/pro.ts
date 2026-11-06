import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getBrand } from "../../lib/brands.js";
import { getPlacement, PLACEMENTS } from "../../lib/placements.js";
import { composePro } from "../../lib/layered/pro.js";
import type { BrandStyle } from "../../lib/layered/compose.js";

const HEX = /^#[0-9a-fA-F]{6}$/;

export function registerProTools(server: McpServer): void {
  server.registerTool(
    "studio_pro_offer",
    {
      title: "Pro Offer Design (agency-style layout)",
      description: `Builds a professional offer post from a photo/background: logo pill top right, a small kicker, one heavy headline, a highlight bar with the key words, a rounded panel with up to 4 icon points (bold part + light part), and a dark contact bar with round icons. Made from the design recipe in docs/design-library/offer-with-list.md. All text is drawn in real fonts (spelling is exactly what you pass). Free: no AI call.

Needs a TEXT-FREE background with the subject on the RIGHT and calm space on the left 55% (make it with studio_generate_from_prompt, or use a real photo). Square to 4:5 canvases.

Args:
  - backgroundPath (string): local image path.
  - headline (string): one short heavy line, e.g. "More enquiries".
  - highlight (string, optional): 2-3 key words on the accent bar.
  - kicker (string, optional): small line above the headline.
  - points (array of { bold, light? }, optional): up to 4 list points.
  - brandId (string, UUID, optional): colours and logo from the brand; primaryColor = panel colour, accentColor = highlight bar and icon colour.
  - primaryColor, accentColor ("#rrggbb", optional), logoPath (optional; a dark-on-white logo, it sits on a white pill).
  - phone, website (strings, optional): contact bar, from the official source only.
  - placementId (string, optional): size, e.g. "square"; default = the background's own size.
  - outPath (string, optional): default "<background>_pro.png".

Returns the file path and any notes (e.g. a point too long).`,
      inputSchema: {
        backgroundPath: z.string().min(1),
        headline: z.string().min(1).max(40),
        highlight: z.string().max(40).optional(),
        kicker: z.string().max(40).optional(),
        points: z.array(z.object({ bold: z.string().min(1).max(40), light: z.string().max(40).optional() })).max(4).optional(),
        brandId: z.string().uuid().optional(),
        primaryColor: z.string().regex(HEX).optional(),
        accentColor: z.string().regex(HEX).optional(),
        logoPath: z.string().min(1).optional(),
        phone: z.string().max(60).optional(),
        website: z.string().max(120).optional(),
        placementId: z.string().optional(),
        outPath: z.string().min(1).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (p: {
      backgroundPath: string;
      headline: string;
      highlight?: string;
      kicker?: string;
      points?: { bold: string; light?: string }[];
      brandId?: string;
      primaryColor?: string;
      accentColor?: string;
      logoPath?: string;
      phone?: string;
      website?: string;
      placementId?: string;
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

        let brand: BrandStyle = { name: "", primary_hex: p.primaryColor ?? "#0f0f14", accent_hex: p.accentColor ?? "#fec107" };
        let logo: Buffer | null = p.logoPath ? await readFile(p.logoPath) : null;
        let contact = p.phone || p.website ? { phone: p.phone, website: p.website } : null;
        if (p.brandId) {
          const b = await getBrand(p.brandId);
          if (!b) return fail(`no brand found with id '${p.brandId}'.`);
          brand = { name: b.name, primary_hex: p.primaryColor ?? b.primary_hex, accent_hex: p.accentColor ?? b.accent_hex, font_family: b.font_family };
          if (!logo && b.logo_url) {
            const res = await fetch(b.logo_url);
            if (res.ok) logo = Buffer.from(await res.arrayBuffer());
          }
          if (!contact && (b.contact_phone || b.website_url)) contact = { phone: b.contact_phone, website: b.website_url };
        }

        const r = await composePro({
          background,
          width,
          height,
          brand,
          logo,
          contact,
          content: { headline: p.headline, highlight: p.highlight, kicker: p.kicker, points: p.points },
        });
        const out = p.outPath ?? path.join(path.dirname(p.backgroundPath), `${path.basename(p.backgroundPath, path.extname(p.backgroundPath))}_pro.png`);
        await writeFile(out, r.png);
        await writeFile(out.replace(/\.png$/i, "") + ".layout.json", JSON.stringify(r.layout, null, 2));
        const text = `# Pro offer design\n\n- Image: ${out} (${width}x${height})${r.notes.length ? `\n- Notes:\n${r.notes.map((n) => `  - ${n}`).join("\n")}` : "\n- No notes."}`;
        return { content: [{ type: "text" as const, text }], structuredContent: { image: out, notes: r.notes } };
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    }
  );
}
