import "server-only";
import { Resvg } from "@resvg/resvg-js";
import sharp, { type OverlayOptions } from "sharp";
import { esc, FONT_FILES, INK, makeMeasurer, onFill, WHITE, type BrandStyle, type ContactInfo, type Face, type Measure } from "./compose";

/**
 * "Pro offer" layout: the look of agency-made offer posts, built from the
 * design recipe in docs/design-library/offer-with-list.md.
 *
 *   logo pill (top right) . small kicker . heavy headline . highlight bar with
 *   the key words . rounded panel with an icon list (bold + light text) .
 *   dark contact bar with round icons.
 *
 * All text is drawn here in real fonts, so spelling is ours. The background
 * (a photo or an AI image WITHOUT text) only needs the subject on the right
 * and calm space on the left; a soft light scrim is laid under the text
 * column so the Ink headline is always readable. Square to 4:5 canvases.
 */

export type ProPoint = { bold: string; light?: string };
export type ProContent = {
  /** Small line above the headline, e.g. "Dental services" (drawn in capitals, letter-spaced). */
  kicker?: string;
  /** Heavy headline line, capitals. */
  headline: string;
  /** Words on the highlight bar under the headline, capitals. */
  highlight?: string;
  /** Up to 4 list points: a bold part, then an optional light part. */
  points?: ProPoint[];
};

const face = (family: string, weight: number): Face => ({ family, weight });
const HEAD = face("Archivo", 900);
const BOLD = face("Inter", 600);
const LIGHT = face("Inter", 400);

const ICONS = {
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  website: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  arrow: '<path d="M7 17L17 7"/><path d="M9 7h8v8"/>',
};
const cleanSite = (u: string) => u.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");

/** Largest size (down to a floor) at which `text` fits on one line of width maxW. */
function fitLine(text: string, f: Face, maxW: number, start: number, measure: Measure, floor = 12) {
  let size = Math.round(start);
  while (size > floor && measure(text, f, size) > maxW) size -= 1;
  return size;
}

export type ProResult = { png: Buffer; notes: string[]; layout: Record<string, unknown> };

export async function composePro(input: {
  background: Buffer;
  width: number;
  height: number;
  content: ProContent;
  brand: BrandStyle;
  logo?: Buffer | null;
  contact?: ContactInfo | null;
}): Promise<ProResult> {
  const { width: W, height: H, content, brand } = input;
  const notes: string[] = [];
  const ratioWH = W / H;
  if (ratioWH < 0.75 || ratioWH > 1.3) notes.push("This layout is made for square to 4:5 canvases; other shapes may look cramped.");
  const measure = makeMeasurer();
  const m = Math.round(W * 0.06);
  const primary = brand.primary_hex;
  const accent = brand.accent_hex || brand.primary_hex;
  const bar = "#0f0f14";
  const shapes: string[] = [];

  // Scrim: a soft light fade under the text column so the Ink headline always reads.
  shapes.push(
    `<defs><linearGradient id="scrim" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fafafa" stop-opacity="0.94"/><stop offset="0.55" stop-color="#fafafa" stop-opacity="0.82"/><stop offset="1" stop-color="#fafafa" stop-opacity="0"/></linearGradient><filter id="sh" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="${Math.round(W * 0.006)}" stdDeviation="${Math.round(W * 0.01)}" flood-color="#000" flood-opacity="0.22"/></filter></defs>`,
    `<rect x="0" y="0" width="${Math.round(W * 0.78)}" height="${H}" fill="url(#scrim)"/>`
  );

  const colW = Math.round(W * 0.52);

  // Logo pill, top right.
  const pillW = Math.round(W * 0.34);
  const pillH = Math.round(W * 0.105);
  const pillX = W - m - pillW;
  const pillY = m;
  shapes.push(`<rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="#ffffff" filter="url(#sh)"/>`);

  // Kicker.
  let y = m + Math.round(W * 0.02);
  if (content.kicker?.trim()) {
    const t = content.kicker.trim().toUpperCase();
    const kickerMax = Math.max(W * 0.2, pillX - m * 2);
    let size = Math.round(W * 0.032);
    while (size > 12 && measure(t, BOLD, size) + t.length * size * 0.18 > kickerMax) size -= 1; // letter-spacing counts
    y += size;
    shapes.push(`<text x="${m}" y="${y}" font-family="Inter" font-weight="600" font-size="${size}" letter-spacing="${size * 0.18}" fill="${INK}">${esc(t)}</text>`);
    y += Math.round(W * 0.025);
  } else y += Math.round(W * 0.06);

  // Headline: one heavy line.
  const head = content.headline.trim().toUpperCase();
  const headSize = fitLine(head, HEAD, colW, W * 0.105, measure, 24);
  y += Math.round(headSize * 0.92);
  shapes.push(`<text x="${m}" y="${y}" font-family="Archivo" font-weight="900" font-size="${headSize}" fill="${INK}">${esc(head)}</text>`);
  y += Math.round(headSize * 0.14);

  // Highlight bar.
  if (content.highlight?.trim()) {
    const t = content.highlight.trim().toUpperCase();
    const padX = Math.round(W * 0.025);
    const size = fitLine(t, HEAD, colW - padX * 2, headSize * 0.92, measure, 20);
    const h = Math.round(size * 1.32);
    const w = Math.round(measure(t, HEAD, size) + padX * 2);
    shapes.push(`<rect x="${m}" y="${y}" width="${w}" height="${h}" rx="${Math.round(h * 0.14)}" fill="${accent}" filter="url(#sh)"/>`);
    shapes.push(`<text x="${m + w / 2}" y="${y + h / 2 + size * 0.36}" text-anchor="middle" font-family="Archivo" font-weight="900" font-size="${size}" fill="${onFill(accent)}">${esc(t)}</text>`);
    y += h;
  }

  // Contact bar geometry (bottom), then the panel fills the space between.
  const barH = Math.round(H * 0.11);
  const barY = H - barH;
  const points = (content.points ?? []).slice(0, 4);
  if ((content.points?.length ?? 0) > 4) notes.push("Only the first 4 list points are shown (more reads as a paragraph, not an offer).");
  const panelGap = Math.round(W * 0.035);
  const panelTop = y + panelGap;
  const panelH = barY - Math.round(W * 0.035) - panelTop;
  const panelW = Math.round(W * 0.56);

  if (points.length) {
    if (panelH < W * 0.2) notes.push("The headline block leaves little room for the list: shorten the headline or the list.");
    const pad = Math.round(W * 0.03);
    shapes.push(`<rect x="${m}" y="${panelTop}" width="${panelW}" height="${panelH}" rx="${Math.round(W * 0.03)}" fill="${primary}" fill-opacity="0.92" filter="url(#sh)"/>`);
    const ink = onFill(primary);
    const rowH = (panelH - pad * 2) / points.length;
    const icon = Math.min(Math.round(W * 0.06), Math.round(rowH * 0.6));
    const textX = m + pad + icon + Math.round(W * 0.025);
    const textW = panelW - pad * 2 - icon - Math.round(W * 0.025);
    // Bold part on the first line, light part on the second; one shared size for every point.
    const lineH = 1.3;
    const lineCount = (p: ProPoint) => (p.light?.trim() ? 2 : 1);
    const fits = (s: number) => points.every((p) => lineCount(p) * s * lineH <= rowH * 0.92 && measure(p.bold.trim(), BOLD, s) <= textW && (!p.light || measure(p.light.trim(), LIGHT, s) <= textW));
    let size = Math.round(W * 0.036);
    while (size > 14 && !fits(size)) size -= 1;
    if (!fits(size)) notes.push("A list point is too long to fit at a readable size: shorten it.");
    points.forEach((p, i) => {
      const cy = panelTop + pad + rowH * i + rowH / 2;
      shapes.push(`<circle cx="${m + pad + icon / 2}" cy="${cy}" r="${icon / 2}" fill="${accent}"/>`);
      shapes.push(`<g transform="translate(${m + pad + icon * 0.22} ${cy - icon * 0.28}) scale(${(icon * 0.56) / 24})" fill="none" stroke="${onFill(accent)}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${ICONS.arrow}</g>`);
      const n = lineCount(p);
      const top = cy - (n * size * lineH) / 2;
      shapes.push(`<text x="${textX}" y="${top + size * 0.95}" font-family="Inter" font-weight="600" font-size="${size}" fill="${ink}">${esc(p.bold.trim())}</text>`);
      if (p.light?.trim()) shapes.push(`<text x="${textX}" y="${top + size * 0.95 + size * lineH}" font-family="Inter" font-weight="400" font-size="${size * 0.92}" fill="${ink}" fill-opacity="0.88">${esc(p.light.trim())}</text>`);
    });
  }

  // Contact bar.
  const items = (
    [
      ["phone", input.contact?.phone?.trim()],
      ["website", input.contact?.website ? cleanSite(input.contact.website) : ""],
      ["email", input.contact?.email?.trim()],
    ] as const
  )
    .filter((i): i is readonly ["phone" | "website" | "email", string] => Boolean(i[1]))
    .slice(0, 2);
  shapes.push(`<rect x="0" y="${barY}" width="${W}" height="${barH}" fill="${bar}"/>`);
  if (items.length) {
    const colWbar = (W - m * 2) / items.length;
    items.forEach(([kind, text], i) => {
      const ic = Math.round(barH * 0.5);
      const gap = Math.round(barH * 0.2);
      const size = fitLine(text, face("Inter", 600), colWbar - ic - gap - Math.round(W * 0.02), barH * 0.36, measure, 14);
      const tw = measure(text, face("Inter", 600), size);
      const x0 = items.length === 1 ? (W - (ic + gap + tw)) / 2 : m + i * colWbar + (i === 0 ? 0 : colWbar - (ic + gap + tw));
      const cy = barY + barH / 2;
      shapes.push(`<circle cx="${x0 + ic / 2}" cy="${cy}" r="${ic / 2}" fill="none" stroke="#ffffff" stroke-width="2"/>`);
      shapes.push(`<g transform="translate(${x0 + ic * 0.25} ${cy - ic * 0.25}) scale(${(ic * 0.5) / 24})" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind]}</g>`);
      shapes.push(`<text x="${x0 + ic + gap}" y="${cy + size * 0.35}" font-family="Inter" font-weight="600" font-size="${size}" fill="${WHITE}">${esc(text)}</text>`);
    });
  } else notes.push("No contact details were given: the bar is empty.");

  const overlay = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${shapes.join("")}</svg>`, {
    font: { loadSystemFonts: false, fontFiles: FONT_FILES },
    background: "rgba(0,0,0,0)",
  })
    .render()
    .asPng();

  const layers: OverlayOptions[] = [{ input: overlay, top: 0, left: 0 }];
  if (input.logo) {
    const lp = await sharp(input.logo, { density: 300 })
      .resize(Math.round(pillW * 0.76), Math.round(pillH * 0.64), { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer({ resolveWithObject: true });
    layers.push({ input: lp.data, top: pillY + Math.round((pillH - lp.info.height) / 2), left: pillX + Math.round((pillW - lp.info.width) / 2) });
  } else notes.push("No logo was given.");

  const png = await sharp(input.background).resize(W, H, { fit: "cover", position: "right" }).removeAlpha().composite(layers).png().toBuffer();
  return { png, notes, layout: { template: "pro-offer", canvas: { W, H }, headSize, content, contact: input.contact ?? null } };
}
