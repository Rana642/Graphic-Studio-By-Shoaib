// v3 (Shoaib's design videos): no decoration that does not help the message (the corner blob is gone),
// a podium grounds the product, one light source from the top-left (glass highlights on top edges,
// shadows fall down-right).
// Tad Pharma — Social Design System v2 ("senior designer" pass, Higgsfield skills):
//  • one expressive move: the red chevron/peak from the logo's "A" stands behind the hero product;
//    everything else is quiet (one glass panel for the points, not three boxes);
//  • clear scale hierarchy: headline → product (hero, real depth: cut-out + contact shadow) → points;
//  • deterministic text/logo/layout (posters-banners rule) — an image model would only supply the
//    background scene in production;
//  • real frosted glass (the background is blurred under each card) in several tints;
//  • no clichés: no shield-for-trust, no leaves, no sparkles.
// Run from graphics-studio: npx tsx scripts/social-design/design-system.ts <outDir>
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { applyFooter, TAD_FOOTER, TAD_VET_LINE } from "./footer";
const req = createRequire(resolve("package.json"));
const sharp = req("sharp");
const { Resvg } = req("@resvg/resvg-js");

const out = process.argv[2];
const FONT = {
  loadSystemFonts: false,
  fontFiles: ["Archivo-700", "Archivo-800", "Archivo-900", "Inter-400", "Inter-600"].map((f) => resolve(`fonts/${f}.ttf`)),
  defaultFontFamily: "Inter",
};
const ARCHIVO = "Archivo SemiBold"; // fontsource static Archivo files are named this (weights 700/800/900)
const W = 1080, H = 1350, M = 72, HEADER = 150;
const C = { red: "#ED1C24", deep: "#C41319", ink: "#231F20", grey: "#4A4547", pearl: "#F4F2F2" };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const render = (svg: string): Buffer => new Resvg(svg, { font: FONT, background: "rgba(0,0,0,0)" }).render().asPng();
const svgDoc = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`;

function measure(text: string, family: string, weight: number, size: number): number {
  return new Resvg(svgDoc(3000, 200, `<text x="0" y="120" font-family="${family}" font-weight="${weight}" font-size="${size}">${esc(text)}</text>`), { font: FONT }).getBBox()?.width ?? text.length * size * 0.55;
}
function wrap(text: string, family: string, weight: number, size: number, maxW: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, family, weight, size) > maxW) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
function balance(text: string, family: string, weight: number, size: number, maxW: number): string[] {
  const n = wrap(text, family, weight, size, maxW).length;
  let lo = maxW * 0.5, hi = maxW;
  while (hi - lo > 4) { const mid = (lo + hi) / 2; if (wrap(text, family, weight, size, mid).length > n) lo = mid; else hi = mid; }
  return wrap(text, family, weight, size, hi);
}
const lines = (ls: string[], x: number, y: number, lh: number, family: string, weight: number, size: number, fill: string, anchor = "start") =>
  ls.map((l, i) => `<text x="${x}" y="${y + i * lh}" font-family="${family}" font-weight="${weight}" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${esc(l)}</text>`).join("");

const ICON: Record<string, string> = {
  flask: '<path d="M9 3h6"/><path d="M10 3v6.2L4.6 18.4A2 2 0 0 0 6.3 21.4h11.4a2 2 0 0 0 1.7-3L14 9.2V3"/><path d="M7.5 15h9"/>',
  microbe: '<rect x="6" y="8.5" width="12" height="7" rx="3.5" transform="rotate(-35 12 12)"/><path d="M4.5 9.5 3 8.5M19.5 14.5l1.5 1M8.6 4.6 8 3M15.4 19.4l.6 1.6M3.5 3.5l17 17"/>',
  egg: '<path d="M12 22c4.2 0 7-3.1 7-7.4C19 9.4 15.8 2 12 2S5 9.4 5 14.6C5 18.9 7.8 22 12 22z"/><path d="M9.2 9.5c.5-1.6 1.4-2.9 2.3-3.4"/>',
  bottle: '<path d="M10 2h4"/><path d="M10 2v3.5c0 .6-.4 1-1 1.5-.6.5-1 1.2-1 2V20a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V9c0-.8-.4-1.5-1-2-.6-.5-1-.9-1-1.5V2"/><path d="M8 13h8"/>',
  drop: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z"/>',
};
const icon = (name: string, cx: number, cy: number, d: number, fill = C.red, stroke = "#FFFFFF") =>
  `<circle cx="${cx}" cy="${cy}" r="${d / 2}" fill="${fill}"/>` +
  `<g transform="translate(${cx - d * 0.27} ${cy - d * 0.27}) scale(${(d * 0.54) / 24})" fill="none" stroke="${stroke}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</g>`;

/** Background: Pearl → white with soft brand light. In production an image model paints a
 *  bright farm scene here; the grid, glass, type and logo stay code. */
function background(peakX: number, peakTop: number, peakBase: number, peakHalf: number): Buffer {
  return render(svgDoc(W, H, `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#F3EFEF"/></linearGradient>
    <radialGradient id="b1"><stop offset="0" stop-color="${C.red}" stop-opacity="0.16"/><stop offset="1" stop-color="${C.red}" stop-opacity="0"/></radialGradient>
    <radialGradient id="b2"><stop offset="0" stop-color="#F7C6C8" stop-opacity="0.55"/><stop offset="1" stop-color="#F7C6C8" stop-opacity="0"/></radialGradient>
    <linearGradient id="peak" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.red}" stop-opacity="0.95"/><stop offset="0.55" stop-color="${C.red}" stop-opacity="0.55"/><stop offset="1" stop-color="${C.red}" stop-opacity="0"/></linearGradient>
    <linearGradient id="peakIn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.0"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0.9"/></linearGradient>
    <linearGradient id="peakInner" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.red}" stop-opacity="0.08"/><stop offset="1" stop-color="${C.red}" stop-opacity="0"/></linearGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="40"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="${peakX}" cy="${peakTop + 260}" r="430" fill="url(#b1)"/>
  <!-- the brand device: the logo's "A" peak, as a soft red chevron stage -->
  <path d="M${peakX - peakHalf} ${peakBase} L${peakX} ${peakTop} L${peakX + peakHalf} ${peakBase} L${peakX + peakHalf - 70} ${peakBase} L${peakX} ${peakTop + 120} L${peakX - peakHalf + 70} ${peakBase} Z" fill="url(#peak)"/>
  <path d="M${peakX - peakHalf + 70} ${peakBase} L${peakX} ${peakTop + 120} L${peakX + peakHalf - 70} ${peakBase} Z" fill="url(#peakInner)"/>`));
}

type Tint = { fill: string; alpha: number; border?: number };
const TINTS: Record<string, Tint> = {
  white: { fill: "#FFFFFF", alpha: 0.62 },
  pearl: { fill: "#F4F2F2", alpha: 0.72 },
  blush: { fill: "#FDE8E9", alpha: 0.7 },
  red: { fill: C.red, alpha: 0.86, border: 0.45 },
  mist: { fill: "#E9E6E7", alpha: 0.6 },
};
/** Real frosted glass: the pixels under the card are blurred, then tinted, with a thin light
 *  border, a glossy top edge and a soft long shadow. */
async function glassOn(base: Buffer, x: number, y: number, w: number, h: number, r: number, tint: Tint): Promise<Buffer> {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const { width: BW = W, height: BH = H } = await sharp(base).metadata();
  const shadow = render(svgDoc(BW, BH, `<defs><filter id="s" x="-30%" y="-30%" width="160%" height="180%"><feGaussianBlur stdDeviation="18"/></filter></defs><rect x="${x + 6}" y="${y + 16}" width="${w - 12}" height="${h}" rx="${r}" fill="#5A1E20" fill-opacity="0.10" filter="url(#s)"/>`));
  const withShadow = await sharp(base).composite([{ input: shadow, left: 0, top: 0 }]).png().toBuffer();
  const mask = Buffer.from(svgDoc(w, h, `<rect width="${w}" height="${h}" rx="${r}" fill="#fff"/>`));
  const patch = await sharp(await sharp(withShadow).extract({ left: x, top: y, width: w, height: h }).blur(24).png().toBuffer())
    .composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  const top = render(svgDoc(w, h, `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.75"/><stop offset="0.16" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient></defs>
    <rect width="${w}" height="${h}" rx="${r}" fill="${tint.fill}" fill-opacity="${tint.alpha}"/>
    <rect width="${w}" height="${h}" rx="${r}" fill="url(#g)"/>
    <rect x="0.75" y="0.75" width="${w - 1.5}" height="${h - 1.5}" rx="${r}" fill="none" stroke="#FFFFFF" stroke-opacity="${tint.border ?? 0.85}" stroke-width="1.5"/>`));
  return sharp(withShadow).composite([{ input: patch, left: x, top: y }, { input: top, left: x, top: y }]).png().toBuffer();
}

/** Cut the pack out of its white studio background: flood fill from the image border over
 *  backdrop-white pixels (min channel >= 252 — the lit shoulder is 246–251, so the fill stops at
 *  the bottle), drop the pale floor reflection under the base, soften the edge by one pixel. */
async function cutout(photo: Buffer, height: number): Promise<{ png: Buffer; w: number; h: number }> {
  const { data, info } = await sharp(photo).resize({ height }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const v = (p: number) => Math.min(data[p * 3], data[p * 3 + 1], data[p * 3 + 2]);
  const bg = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (bg[p] || v(p) < 252) continue;
    bg[p] = 1;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  // Bottom of the pack: the last row that still has a real dark contour (the reflection is pale).
  let bottom = h - 1;
  const rowDark = (y: number) => { let d = 255; for (let x = 0; x < w; x++) if (!bg[y * w + x]) d = Math.min(d, v(y * w + x)); return d; };
  while (bottom > 0 && rowDark(bottom) > 222) bottom--;
  // The floor reflection is paler than the pack: drop bottom rows whose pack pixels average >= 241.
  const rowMean = (y: number) => { let t = 0, n = 0; for (let x = 0; x < w; x++) if (!bg[y * w + x]) { t += v(y * w + x); n++; } return n ? t / n : 255; };
  while (bottom > 0 && rowMean(bottom) >= 241) bottom--;
  // Base corners: below the body the pack keeps the body's width with rounded corners (radius
  // ~5% of the height) — the floor shadow beside the base is as dark as the pack's outline.
  const yb = bottom - Math.round(h * 0.12);
  let bl = w, br = -1;
  for (let x = 0; x < w; x++) if (!bg[yb * w + x]) { if (bl === w) bl = x; br = x; }
  const rc = Math.round(h * 0.05);
  const span: [number, number][] = [];
  for (let y = 0; y <= bottom; y++) {
    if (y <= yb) { span.push([0, w - 1]); continue; }
    const dy = y - (bottom - rc);
    const inset = dy > 0 ? rc - Math.sqrt(Math.max(0, rc * rc - dy * dy)) : 0;
    span.push([Math.round(bl + inset), Math.round(br - inset)]);
  }
  const rgba = Buffer.alloc(w * (bottom + 1) * 4);
  for (let y = 0; y <= bottom; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, o = p * 4;
    let n = 0, f = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy > bottom) continue;
      n++; if (!bg[yy * w + xx] && xx >= span[yy][0] && xx <= span[yy][1]) f++;
    }
    rgba[o] = data[p * 3]; rgba[o + 1] = data[p * 3 + 1]; rgba[o + 2] = data[p * 3 + 2];
    // Near the base, pale pixels are floor reflection, not pack.
    const reflection = y > bottom - h * 0.07 && v(p) >= 246;
    const outside = x < span[y][0] || x > span[y][1];
    rgba[o + 3] = bg[p] || reflection || outside ? 0 : Math.round((255 * f) / n);
  }
  const png = await sharp(rgba, { raw: { width: w, height: bottom + 1, channels: 4 } }).png().toBuffer();
  return { png, w, h: bottom + 1 };
}

/** A light podium under the product (one light source from the top-left): white top, Pearl side
 *  shaded darker on the right, soft shadow falling down-right. */
function podium(cx: number, topY: number, rx: number, ry: number, t: number): Buffer {
  return render(svgDoc(W, H, `<defs>
    <linearGradient id="side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#F6F2F2"/><stop offset="1" stop-color="#DCD4D5"/></linearGradient>
    <linearGradient id="top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#F1ECEC"/></linearGradient>
    <filter id="ps" x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="16"/></filter>
  </defs>
  <ellipse cx="${cx + 14}" cy="${topY + t + 18}" rx="${rx * 1.04}" ry="${ry * 0.9}" fill="#3A1214" fill-opacity="0.16" filter="url(#ps)"/>
  <path d="M${cx - rx} ${topY} L${cx - rx} ${topY + t} A${rx} ${ry} 0 0 0 ${cx + rx} ${topY + t} L${cx + rx} ${topY} Z" fill="url(#side)"/>
  <ellipse cx="${cx}" cy="${topY}" rx="${rx}" ry="${ry}" fill="url(#top)" stroke="#FFFFFF" stroke-width="1.5"/>`));
}

async function placeProduct(base: Buffer, prod: { png: Buffer; w: number; h: number }, cx: number, bottom: number): Promise<Buffer> {
  const left = Math.round(cx - prod.w / 2), top = Math.round(bottom - prod.h);
  const shadow = render(svgDoc(W, H, `<defs><filter id="s" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="14"/></filter></defs>
    <ellipse cx="${cx}" cy="${bottom - 6}" rx="${prod.w * 0.48}" ry="18" fill="#3A1214" fill-opacity="0.28" filter="url(#s)"/>
    <ellipse cx="${cx}" cy="${bottom - 4}" rx="${prod.w * 0.34}" ry="7" fill="#3A1214" fill-opacity="0.30" filter="url(#s)"/>`));
  return sharp(base).composite([{ input: shadow, left: 0, top: 0 }, { input: prod.png, left, top }]).png().toBuffer();
}

const HEAD = ["Strong Protection", "Against Gut Diseases"];
const POINTS: [string, string][] = [
  ["flask", "Organic acids, vitamins and amino acids in one liquid"],
  ["microbe", "Lowers the risk of gut problems: E. coli, Salmonella, Clostridia"],
  ["egg", "Improves egg production, fertility and hatching"],
];
const PACK = "1000 ml";
const DOSE = "Poultry: 100 ml in 200 litres of water, for 5–10 days";

/** Headline with one Tad Red highlight phrase (the lock allows one). */
function headline(x: number, y: number, size: number, lh: number, anchor: "start" | "middle"): string {
  const [a, b] = HEAD;
  const hi = "Gut Diseases";
  const pre = b.replace(hi, "");
  if (anchor === "middle") {
    const wPre = measure(pre, ARCHIVO, 800, size), wHi = measure(hi, ARCHIVO, 800, size);
    const x0 = x - (wPre + wHi) / 2;
    return lines([a], x, y, lh, ARCHIVO, 800, size, C.ink, "middle") +
      `<text x="${x0}" y="${y + lh}" font-family="${ARCHIVO}" font-weight="800" font-size="${size}"><tspan fill="${C.ink}">${esc(pre)}</tspan><tspan fill="${C.red}">${esc(hi)}</tspan></text>`;
  }
  return lines([a], x, y, lh, ARCHIVO, 800, size, C.ink) +
    `<text x="${x}" y="${y + lh}" font-family="${ARCHIVO}" font-weight="800" font-size="${size}"><tspan fill="${C.ink}">${esc(pre)}</tspan><tspan fill="${C.red}">${esc(hi)}</tspan></text>`;
}

/** Chips in ONE row: pack size on red glass (white text), dose on white glass. */
async function chips(base: Buffer, x: number, y: number, anchor: "start" | "middle"): Promise<{ buf: Buffer; svg: string }> {
  const hgt = 62, padX = 26;
  const wPack = 40 + 12 + measure(PACK, ARCHIVO, 700, 26) + padX * 2;
  const wDose = measure(DOSE, "Inter", 400, 23) + padX * 2;
  const total = wPack + 14 + wDose;
  const x0 = anchor === "middle" ? x - total / 2 : x;
  let buf = await glassOn(base, x0, y, wPack, hgt, hgt / 2, TINTS.red);
  buf = await glassOn(buf, x0 + wPack + 14, y, wDose, hgt, hgt / 2, TINTS.white);
  const svg = icon("bottle", x0 + padX + 20, y + hgt / 2, 40, "#FFFFFF", C.red) +
    `<text x="${x0 + padX + 52}" y="${y + hgt / 2 + 9}" font-family="${ARCHIVO}" font-weight="700" font-size="26" fill="#FFFFFF">${PACK}</text>` +
    `<text x="${x0 + wPack + 14 + padX}" y="${y + hgt / 2 + 8}" font-family="Inter" font-weight="400" font-size="23" fill="${C.ink}">${esc(DOSE)}</text>`;
  return { buf, svg };
}

async function finish(base: Buffer, overlaySvg: string, logo: Buffer, logoX: number, logoY: number): Promise<Buffer> {
  let post = await sharp(base).composite([{ input: render(svgDoc(W, H, overlaySvg)), left: 0, top: 0 }]).png().toBuffer();
  post = await applyFooter(post, { ...TAD_FOOTER, vetLine: TAD_VET_LINE });
  return sharp(post).composite([{ input: logo, left: logoX, top: logoY }]).png().toBuffer();
}

(async () => {
  const logoSrc = Buffer.from(await (await fetch("https://cdn.jsdelivr.net/gh/Rana642/adsbyshoaib-kb-assets@546bf3593260f286927e1d7ee4b4f507e08d9da1/tad-pharma/assets/tad-pharma-logo.png")).arrayBuffer());
  const logo = await sharp(await sharp(logoSrc).trim().toBuffer()).resize({ width: 300 }).png().toBuffer();
  const { height: logoH = 38 } = await sharp(logo).metadata();
  const photo = Buffer.from(await (await fetch("https://cdn.jsdelivr.net/gh/Rana642/adsbyshoaib-kb-assets@cd0bfaa84ad3a612ac63baed90671849db4cd700/tad-pharma/products/aminotox.jpg")).arrayBuffer());
  const logoY = Math.round((HEADER - logoH) / 2);

  // ── A) TOP-LEFT: left text column, hero product on the red peak at the right ──
  {
    const prod = await cutout(photo, 600);
    const cx = 812, podTop = 996, bottom = podTop + 8;
    let base = background(cx, 372, 1060, 250);
    base = await sharp(base).composite([{ input: podium(cx, podTop, 176, 26, 22), left: 0, top: 0 }]).png().toBuffer();
    const panel = { x: M, y: 400, w: 512, h: 600 };
    base = await glassOn(base, panel.x, panel.y, panel.w, panel.h, 28, TINTS.white);
    const rowH = panel.h / 3, ICON_D = 60, tx = panel.x + 28 + ICON_D + 20, tw = panel.w - (tx - panel.x) - 28;
    let svg = headline(M, HEADER + 102, 76, 84, "start");
    POINTS.forEach(([ic, t], i) => {
      const y = panel.y + i * rowH;
      const ls = balance(t, "Inter", 600, 28, tw);
      const first = y + (rowH - ls.length * 38) / 2 + 27;
      svg += icon(ic, panel.x + 28 + ICON_D / 2, y + rowH / 2, ICON_D) + lines(ls, tx, first, 38, "Inter", 600, 28, C.ink);
      if (i) svg += `<line x1="${tx}" y1="${y}" x2="${panel.x + panel.w - 28}" y2="${y}" stroke="${C.ink}" stroke-opacity="0.10" stroke-width="1.5"/>`;
    });
    base = await placeProduct(base, prod, cx, bottom);
    const ch = await chips(base, M, 1078, "start");
    writeFileSync(join(out, "ds-v3-A-top-left.png"), await finish(ch.buf, svg + ch.svg, logo, M, logoY));
  }

  // ── B) TOP-CENTRE: centred layout, product as the hero in the middle ──
  {
    const prod = await cutout(photo, 430);
    const cx = W / 2, podTop = 820, bottom = podTop + 7;
    let base = background(cx, 380, 880, 230);
    base = await sharp(base).composite([{ input: podium(cx, podTop, 150, 22, 20), left: 0, top: 0 }]).png().toBuffer();
    const panel = { x: M, y: 886, w: W - 2 * M, h: 186 };
    base = await placeProduct(base, prod, cx, bottom);
    base = await glassOn(base, panel.x, panel.y, panel.w, panel.h, 28, TINTS.white);
    let svg = headline(W / 2, HEADER + 92, 72, 80, "middle");
    const colW = panel.w / 3;
    POINTS.forEach(([ic, t], i) => {
      const cxi = panel.x + colW * i + colW / 2;
      svg += icon(ic, cxi, panel.y + 46, 52);
      svg += lines(balance(t, "Inter", 600, 21, colW - 44), cxi, panel.y + 104, 27, "Inter", 600, 21, C.ink, "middle");
      if (i) svg += `<line x1="${panel.x + colW * i}" y1="${panel.y + 26}" x2="${panel.x + colW * i}" y2="${panel.y + panel.h - 26}" stroke="${C.ink}" stroke-opacity="0.10" stroke-width="1.5"/>`;
    });
    const ch = await chips(base, W / 2, 1090, "middle");
    writeFileSync(join(out, "ds-v3-B-top-centre.png"), await finish(ch.buf, svg + ch.svg, logo, Math.round((W - 300) / 2), logoY));
  }

  // ── Glass in brand tints ──
  {
    const GH = 760;
    let base = await sharp(background(760, 120, 900, 330)).extract({ left: 0, top: 0, width: W, height: GH }).png().toBuffer();
    const deco = render(svgDoc(W, GH, `<circle cx="200" cy="470" r="150" fill="${C.red}" fill-opacity="0.55"/><circle cx="560" cy="300" r="90" fill="#F7C6C8"/><rect x="760" y="520" width="260" height="120" rx="60" fill="${C.red}" fill-opacity="0.35"/>`));
    base = await sharp(base).composite([{ input: deco, left: 0, top: 0 }]).png().toBuffer();
    const cards: [string, string, string][] = [
      ["white", "White glass", "default cards, panels"],
      ["pearl", "Pearl glass", "quiet background panels"],
      ["blush", "Blush glass", "one highlight card"],
      ["red", "Red glass", "one key chip or button"],
      ["mist", "Mist glass", "secondary info"],
    ];
    const cw = 290, chh = 150, gap = 24;
    let svg = `<text x="${M}" y="92" font-family="${ARCHIVO}" font-weight="800" font-size="40" fill="${C.ink}">Glass in brand tints</text>
      <text x="${M}" y="130" font-family="Inter" font-weight="400" font-size="19" fill="${C.grey}">Real frosted glass: the scene behind is blurred, then tinted. Never dark.</text>`;
    for (const [i, [k, name, use]] of cards.entries()) {
      const col = i % 3, row = Math.floor(i / 3);
      const x = M + col * (cw + gap) + (row ? (cw + gap) / 2 : 0), y = 200 + row * (chh + 40);
      base = await glassOn(base, x, y, cw, chh, 26, TINTS[k]);
      const light = k === "red";
      svg += `<text x="${x + 26}" y="${y + 62}" font-family="${ARCHIVO}" font-weight="700" font-size="26" fill="${light ? "#FFFFFF" : C.ink}">${name}</text>` +
        `<text x="${x + 26}" y="${y + 98}" font-family="Inter" font-weight="400" font-size="18" fill="${light ? "#FFFFFF" : C.grey}">${use}</text>`;
    }
    writeFileSync(join(out, "ds-v3-glass-tints.png"), await sharp(base).composite([{ input: render(svgDoc(W, GH, svg)), left: 0, top: 0 }]).png().toBuffer());
  }
  console.log("ok");
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
