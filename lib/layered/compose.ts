import "server-only";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import sharp, { type OverlayOptions } from "sharp";
import { layoutFor, PRESETS, type Box, type LayoutZones, type Preset } from "./layouts";

/**
 * "Exact text" designs: the AI draws only a text-free background, and this
 * module puts the words, badge, CTA button and logo on top in real fonts, so
 * the spelling is ours and a text change costs nothing. Fonts are resolved
 * from the repo's own font files (resvg embeds them: no system fontconfig, and
 * HarfBuzz shaping for Urdu), the same way lib/asset-locked/render.ts does.
 */

const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fonts");
export const FONT_FILES = ["Archivo-700.ttf", "Archivo-800.ttf", "Archivo-900.ttf", "Inter-400.ttf", "Inter-600.ttf", "Inter.ttf", "NotoNastaliqUrdu.ttf"].map((f) =>
  path.join(FONTS_DIR, f)
);

export const INK = "#0f0f14";
export const WHITE = "#ffffff";
/** WCAG AA for large text (a headline); small text would need 4.5. */
const HEADLINE_MIN_CONTRAST = 3;
/** More than this share of the letters' own pixels on a background they can't be read on fails the check. */
const MAX_HARD_SHARE = 0.01;

export type BrandStyle = { name: string; primary_hex: string; accent_hex?: string | null; font_family?: string | null };
export type ComposeContent = { label?: string; hook: string; cta?: string };
/** Contact details for the footer strip, copied from the brand's official website. */
export type ContactInfo = { phone?: string | null; email?: string | null; website?: string | null };

export type Face = { family: string; weight: number };

export type ComposeResult = {
  png: Buffer;
  /** Everything needed to recompose later (text, fonts, positions) — saved next to the image. */
  layoutJson: Record<string, unknown>;
  report: {
    preset: Preset;
    hookFontSize: number;
    hookLines: string[];
    textColor: string;
    /** Worst-case contrast of the headline against the pixels behind it. */
    contrast: number;
    contrastPass: boolean;
    /** Share of the pixels behind the headline it cannot be read on (0-1). */
    hardToReadShare: number;
    notes: string[];
  };
};

export const hasUrdu = (s: string) => /[؀-ۿ]/.test(s);
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function faces(brand: BrandStyle, urdu: boolean): { heading: Face; body: Face; notes: string[] } {
  const notes: string[] = [];
  if (urdu) return { heading: { family: "Noto Nastaliq Urdu", weight: 400 }, body: { family: "Noto Nastaliq Urdu", weight: 400 }, notes };
  const wanted = (brand.font_family ?? "").toLowerCase();
  if (wanted && !/archivo|inter/.test(wanted)) notes.push(`Brand font "${brand.font_family}" is not bundled; used Archivo (headline) and Inter (body).`);
  const heading: Face = wanted.includes("inter") ? { family: "Inter", weight: 700 } : { family: "Archivo", weight: 800 };
  return { heading, body: { family: "Inter", weight: 600 }, notes };
}

/** Width of one line of text in px, measured by rendering it (cached). */
export function makeMeasurer() {
  const cache = new Map<string, number>();
  return (text: string, face: Face, size: number): number => {
    const key = `${face.family}|${face.weight}|${size}|${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="400"><text x="0" y="200" font-family="${face.family}" font-weight="${face.weight}" font-size="${size}">${esc(text)}</text></svg>`;
    const box = new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: FONT_FILES } }).getBBox();
    const w = box ? box.width : text.length * size * 0.55;
    cache.set(key, w);
    return w;
  };
}

export type Measure = ReturnType<typeof makeMeasurer>;

function wrap(text: string, face: Face, size: number, maxW: number, measure: Measure): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, face, size) > maxW) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Biggest headline size that fits the box in at most two lines (the layout rule), never below the readable floor. */
function fitHeadline(text: string, face: Face, box: Box, short: number, measure: Measure) {
  const floor = Math.max(28, Math.round((40 * short) / 1080));
  let size = Math.round(short * 0.11);
  const lineHeight = 1.12;
  for (; size >= floor; size -= Math.max(2, Math.round(size * 0.04))) {
    const lines = wrap(text, face, size, box.w, measure);
    const widest = Math.max(...lines.map((l) => measure(l, face, size)));
    if (lines.length <= 2 && widest <= box.w && lines.length * size * lineHeight <= box.h) return { size, lines, lineHeight, fits: true };
  }
  size = floor;
  return { size, lines: wrap(text, face, size, box.w, measure), lineHeight, fits: false };
}

// --- contrast (WCAG 2.x) ---------------------------------------------------

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = (r: number, g: number, b: number) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
const hexLum = (hex: string) => {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return lum((n >> 16) & 255, (n >> 8) & 255, n & 255);
};
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Darkest and lightest 10% luminance of the pixels in a box (raw RGB, 3 channels). */
function regionLuminance(raw: Buffer, width: number, height: number, box: Box) {
  const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(width, Math.ceil(box.x + box.w)), y1 = Math.min(height, Math.ceil(box.y + box.h));
  const values: number[] = [];
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * width + x) * 3;
      values.push(lum(raw[i] ?? 0, raw[i + 1] ?? 0, raw[i + 2] ?? 0));
    }
  }
  if (values.length === 0) return { dark: 0.5, light: 0.5, values };
  values.sort((a, b) => a - b);
  return { dark: values[Math.floor(values.length * 0.1)] ?? 0, light: values[Math.floor(values.length * 0.9)] ?? 1, values };
}

/** Share of the sampled pixels behind the text that the colour cannot be read on (contrast under 3:1). */
const hardToRead = (textLum: number, values: number[]) =>
  values.length === 0 ? 0 : values.filter((v) => ratio(textLum, v) < HEADLINE_MIN_CONTRAST).length / values.length;

/** Ink or white for the headline: the one with the fewest unreadable pixels behind it, then the better worst-case contrast. */
function pickTextColor(region: { dark: number; light: number; values: number[] }) {
  const inkLum = hexLum(INK);
  const options = [
    { color: INK, contrast: ratio(inkLum, region.dark), share: hardToRead(inkLum, region.values) }, // dark text is hardest to read on the darkest pixels
    { color: WHITE, contrast: ratio(1, region.light), share: hardToRead(1, region.values) }, // white text on the lightest
  ];
  options.sort((a, b) => a.share - b.share || b.contrast - a.contrast);
  return options[0] as { color: string; contrast: number; share: number };
}

/** The headline as SVG <text> lines (the same markup draws the real headline and the glyph mask used to check it). */
function headlineText(layout: LayoutZones, fit: { size: number; lines: string[]; lineHeight: number }, face: Face, urdu: boolean, color: string): string {
  const anchor = layout.align === "center" ? "middle" : urdu ? "end" : "start";
  const rtl = urdu ? ' direction="rtl"' : "";
  return fit.lines
    .map((line, i) => {
      const x = layout.align === "center" ? layout.hook.x + layout.hook.w / 2 : urdu ? layout.hook.x + layout.hook.w : layout.hook.x;
      const y = layout.hook.y + fit.size * 0.88 + i * fit.size * fit.lineHeight;
      return `<text x="${x}" y="${y}" text-anchor="${anchor}"${rtl} font-family="${face.family}" font-weight="${face.weight}" font-size="${fit.size}" fill="${color}">${esc(line)}</text>`;
    })
    .join("");
}

/** Luminance of the background pixels that sit exactly under the letters (alpha > 50% in the mask). */
function glyphLuminance(raw: Buffer, width: number, height: number, mask: Buffer, box: Box) {
  const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(width, Math.ceil(box.x + box.w)), y1 = Math.min(height, Math.ceil(box.y + box.h));
  const values: number[] = [];
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      if ((mask[(y * width + x) * 4 + 3] ?? 0) <= 128) continue;
      const i = (y * width + x) * 3;
      values.push(lum(raw[i] ?? 0, raw[i + 1] ?? 0, raw[i + 2] ?? 0));
    }
  }
  if (values.length === 0) return regionLuminance(raw, width, height, box);
  values.sort((a, b) => a - b);
  return { dark: values[Math.floor(values.length * 0.1)] ?? 0, light: values[Math.floor(values.length * 0.9)] ?? 1, values };
}

export const onFill = (fillHex: string) => (ratio(hexLum(INK), hexLum(fillHex)) >= ratio(1, hexLum(fillHex)) ? INK : WHITE);

// --- contact strip -----------------------------------------------------------

const ICON_PATHS: Record<"phone" | "email" | "website", string> = {
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  website: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
};

const cleanSite = (url: string) => url.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");

type StripPlan = { svg: string; top: number; height: number };

/**
 * The footer contact strip, in the fixed house style: thin, edge to edge,
 * lifted a little off the bottom edge with a soft shadow, plain outline icons
 * and the details in up to three evenly spaced columns, nothing else inside.
 * Colours come from the brand; the text colour is chosen against the strip.
 */
function contactStrip(width: number, height: number, brand: BrandStyle, contact: ContactInfo | null | undefined, body: Face, measure: Measure): StripPlan | null {
  const items = (
    [
      ["phone", contact?.phone?.trim()],
      ["email", contact?.email?.trim()],
      ["website", contact?.website ? cleanSite(contact.website) : ""],
    ] as const
  ).filter((i): i is readonly ["phone" | "email" | "website", string] => Boolean(i[1]));
  if (items.length === 0) return null;

  const scale = width / 1080;
  const h = Math.max(44, Math.round(64 * scale));
  const top = height - Math.round(40 * scale) - h;
  const fill = brand.primary_hex;
  const ink = onFill(fill);
  const colW = width / items.length;
  const iconSize = Math.round(h * 0.42);
  const gap = Math.round(h * 0.2);

  const parts: string[] = [
    `<defs><filter id="strip-shadow" x="-5%" y="-40%" width="110%" height="190%"><feDropShadow dx="0" dy="${Math.round(h * 0.06)}" stdDeviation="${Math.round(h * 0.1)}" flood-color="#000000" flood-opacity="0.25"/></filter></defs>`,
    `<rect x="0" y="${top}" width="${width}" height="${h}" fill="${fill}" filter="url(#strip-shadow)"/>`,
  ];
  items.forEach(([kind, text], i) => {
    let size = Math.round(h * 0.34);
    const room = colW - h * 0.8 - iconSize - gap;
    while (size > Math.round(h * 0.2) && measure(text, body, size) > room) size -= 1;
    const textW = measure(text, body, size);
    const x0 = i * colW + (colW - (iconSize + gap + textW)) / 2;
    parts.push(
      `<g transform="translate(${x0} ${top + (h - iconSize) / 2}) scale(${iconSize / 24})" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[kind]}</g>`,
      `<text x="${x0 + iconSize + gap}" y="${top + h / 2 + size * 0.35}" font-family="${body.family}" font-weight="${body.weight}" font-size="${size}" fill="${ink}">${esc(text)}</text>`
    );
    if (i > 0) parts.push(`<line x1="${i * colW}" y1="${top + h * 0.25}" x2="${i * colW}" y2="${top + h * 0.75}" stroke="${ink}" stroke-opacity="0.3" stroke-width="1.5"/>`);
  });
  return { svg: parts.join(""), top, height: h };
}

// --- planning and rendering --------------------------------------------------

function plan(preset: Preset, canvas: { width: number; height: number }, raw: Buffer, content: ComposeContent, headingFace: Face, urdu: boolean, measure: Measure, footer: number) {
  const base = layoutFor(canvas.width, canvas.height, preset, footer);
  const short = Math.min(canvas.width, canvas.height);
  const fit = fitHeadline(content.hook, headingFace, base.hook, short, measure);
  const widest = Math.max(...fit.lines.map((l) => measure(l, headingFace, fit.size)));
  const textH = fit.lines.length * fit.size * fit.lineHeight;

  // Stack badge, headline and CTA tightly around the real text height (not the reserved box).
  const hasLabel = Boolean(content.label?.trim());
  const hasCta = Boolean(content.cta?.trim());
  const labelY = base.hook.y - base.gap - base.label.h;
  const ctaY = base.hook.y + textH + base.gap;
  const top = hasLabel ? labelY : base.hook.y;
  const bottom = hasCta ? ctaY + base.cta.h : base.hook.y + textH;
  const belowLogo = base.logo.y + base.logo.h + base.gap;
  let shift = preset === "bottom" ? base.height - base.margin - base.footer - bottom : 0;
  shift = Math.max(shift, belowLogo - (top + shift) + shift); // never start above the logo's bottom edge

  const layout: LayoutZones = {
    ...base,
    label: { ...base.label, y: Math.round(labelY + shift) },
    hook: { ...base.hook, y: Math.round(base.hook.y + shift), h: Math.round(textH) },
    cta: { ...base.cta, y: Math.round(ctaY + shift) },
  };
  const textBox: Box = {
    x: layout.align === "center" ? layout.hook.x + (layout.hook.w - widest) / 2 : layout.hook.x,
    y: layout.hook.y,
    w: widest,
    h: textH,
  };
  const mask = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}">${headlineText(layout, fit, headingFace, urdu, "#000000")}</svg>`, {
    font: { loadSystemFonts: false, fontFiles: FONT_FILES },
    background: "rgba(0,0,0,0)",
  })
    .render().pixels;
  const picked = pickTextColor(glyphLuminance(raw, canvas.width, canvas.height, Buffer.from(mask), textBox));
  return { layout, fit, textBox, ...picked };
}

export async function composeLayered(input: {
  background: Buffer;
  width: number;
  height: number;
  content: ComposeContent;
  brand: BrandStyle;
  /** The logo image to place (png/jpg/svg). Pick the variant that suits the background. */
  logo?: Buffer | null;
  preset?: Preset | "auto";
  /** When given (and not empty), the footer contact strip is drawn and the layout keeps clear of it. */
  contact?: ContactInfo | null;
  /** Where to anchor the crop when the background is a different shape (sharp position, e.g. "right"). */
  bgPosition?: string;
}): Promise<ComposeResult> {
  const { width, height, content, brand } = input;
  const urdu = hasUrdu(content.hook);
  const { heading, body, notes } = faces(brand, urdu);
  const measure = makeMeasurer();

  const bg = sharp(input.background).resize(width, height, { fit: "cover", position: input.bgPosition ?? "centre" }).removeAlpha();
  const [bgPng, rawInfo] = await Promise.all([bg.clone().png().toBuffer(), bg.clone().raw().toBuffer({ resolveWithObject: true })]);
  const raw = rawInfo.data;

  const strip = contactStrip(width, height, brand, input.contact, body, measure);
  const footer = strip ? height - strip.top + Math.round(Math.min(width, height) * 0.03) : 0;

  const candidates = input.preset && input.preset !== "auto" ? [input.preset] : [...PRESETS];
  const plans = candidates.map((p) => plan(p, { width, height }, raw, content, heading, urdu, measure, footer));
  const better = (b: (typeof plans)[number], a: (typeof plans)[number]) => b.share < a.share - 0.002 || (Math.abs(b.share - a.share) <= 0.002 && b.contrast > a.contrast + 0.05);
  const best = plans.reduce((a, b) => (better(b, a) ? b : a));
  const { layout, fit, textBox, color, contrast, share } = best;
  if (!fit.fits) notes.push("The headline is too long for two lines at a readable size: shorten it.");
  if (share > MAX_HARD_SHARE) notes.push(`${Math.round(share * 100)}% of the pixels behind the headline are hard to read (an object or busy detail sits behind the text). Try another layout, a shorter headline or a calmer background.`);
  if (contrast < HEADLINE_MIN_CONTRAST) notes.push(`The headline's worst-case contrast is ${contrast.toFixed(1)}:1 (needs ${HEADLINE_MIN_CONTRAST}:1): the background behind it is too busy. Use a calmer background area.`);
  if (!input.logo && layout.logo.w > 0) notes.push("No logo was given.");

  const short = Math.min(width, height);
  const shapes: string[] = [];
  const accent = brand.accent_hex || brand.primary_hex;

  // Badge label
  if (content.label?.trim()) {
    const size = Math.round(layout.label.h * 0.5);
    const text = content.label.trim().toUpperCase();
    const w = Math.round(measure(text, body, size) + text.length * size * 0.06 + layout.label.h * 0.9); // + the letter-spacing
    const x = layout.align === "center" ? layout.label.x + (layout.label.w - w) / 2 : layout.label.x;
    shapes.push(`<rect x="${x}" y="${layout.label.y}" width="${w}" height="${layout.label.h}" rx="${layout.label.h / 2}" fill="${accent}"/>`);
    shapes.push(
      `<text x="${x + w / 2}" y="${layout.label.y + layout.label.h / 2 + size * 0.35}" text-anchor="middle" font-family="${body.family}" font-weight="${body.weight}" font-size="${size}" letter-spacing="${size * 0.06}" fill="${onFill(accent)}">${esc(text)}</text>`
    );
  }

  // Headline
  shapes.push(headlineText(layout, fit, heading, urdu, color));

  // CTA button
  if (content.cta?.trim()) {
    const size = Math.round(layout.cta.h * 0.42);
    const text = content.cta.trim();
    const w = Math.round(measure(text, body, size) + layout.cta.h * 1.2);
    const x = layout.align === "center" ? layout.cta.x + (layout.cta.w - w) / 2 : layout.cta.x;
    shapes.push(`<rect x="${x}" y="${layout.cta.y}" width="${w}" height="${layout.cta.h}" rx="${layout.cta.h / 2}" fill="${brand.primary_hex}"/>`);
    shapes.push(
      `<text x="${x + w / 2}" y="${layout.cta.y + layout.cta.h / 2 + size * 0.35}" text-anchor="middle" font-family="${body.family}" font-weight="${body.weight}" font-size="${size}" fill="${onFill(brand.primary_hex)}">${esc(text)}</text>`
    );
  }

  if (strip) shapes.push(strip.svg);

  const overlay = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shapes.join("")}</svg>`, {
    font: { loadSystemFonts: false, fontFiles: FONT_FILES },
    background: "rgba(0,0,0,0)",
  })
    .render()
    .asPng();

  const layers: OverlayOptions[] = [{ input: overlay, top: 0, left: 0 }];
  let logoBox: Box | null = null;
  if (input.logo) {
    const logoPng = await sharp(input.logo, { density: 300 }).resize(layout.logo.w, layout.logo.h, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
    const lx = layout.align === "center" ? Math.round((width - logoPng.info.width) / 2) : layout.logo.x;
    logoBox = { x: lx, y: layout.logo.y, w: logoPng.info.width, h: logoPng.info.height };
    layers.push({ input: logoPng.data, top: layout.logo.y, left: lx });
  }

  const png = await sharp(bgPng).composite(layers).png().toBuffer();

  const layoutJson = {
    version: 1,
    canvas: { width, height },
    preset: layout.preset,
    brand: { name: brand.name, primary: brand.primary_hex, accent, font_family: brand.font_family ?? null },
    fonts: { heading, body },
    content,
    zones: layout satisfies LayoutZones,
    headline: { size: fit.size, lines: fit.lines, color, box: textBox },
    report: { contrastPass: contrast >= HEADLINE_MIN_CONTRAST && share <= MAX_HARD_SHARE, contrast: Number(contrast.toFixed(2)), hardToReadShare: Number(share.toFixed(3)), notes },
    logo: logoBox,
    contact: strip ? input.contact : null,
    short,
  };

  return {
    png,
    layoutJson,
    report: { preset: layout.preset, hookFontSize: fit.size, hookLines: fit.lines, textColor: color, contrast: Number(contrast.toFixed(2)), contrastPass: contrast >= HEADLINE_MIN_CONTRAST && share <= MAX_HARD_SHARE, hardToReadShare: Number(share.toFixed(3)), notes },
  };
}
