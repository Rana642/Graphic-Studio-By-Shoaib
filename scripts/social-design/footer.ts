// Deterministic footer for Tad Pharma posts, drawn exactly to the design lock
// (AI image models never hold the strip's geometry): full-width 64 px Tad Crimson
// Strip whose bottom sits 40 px above the canvas edge, 4 equal columns of outline
// icon + Inter semibold 21 px white text with 55% white dividers, 48 px inner
// padding, soft shadow; optional vet line 16 px above it (product-related posts).
import { resolve } from "node:path";
import { createRequire } from "node:module";
const req = createRequire(resolve("package.json"));
const sharp = req("sharp");
const { Resvg } = req("@resvg/resvg-js");

const W = 1080, H = 1350, STRIP_H = 64, STRIP_GAP = 40, PAD = 48;
const STRIP_Y = H - STRIP_GAP - STRIP_H; // 1246
const FONT = { loadSystemFonts: false, fontFiles: [resolve("fonts/Inter.ttf")], defaultFontFamily: "Inter" };

const ICONS: Record<string, string> = {
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  whatsapp: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M15.6 14.1c-.2.6-1.1 1.1-1.6 1.1-.4.1-1 .1-1.6-.1-.4-.1-.9-.3-1.5-.6-2.6-1.1-4.3-3.8-4.4-4-.1-.2-1.1-1.4-1.1-2.7 0-1.3.7-1.9.9-2.2.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.3 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.5.1.3.6 1 1.3 1.6.9.8 1.6 1 1.9 1.2.2.1.4.1.5-.1l.7-.9c.2-.2.3-.2.5-.1l1.8.9c.3.1.4.2.5.3.1.1.1.5-.1 1z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function textWidth(text: string, size: number, weight: number): number {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="100"><text x="0" y="60" font-family="Inter" font-size="${size}" font-weight="${weight}">${esc(text)}</text></svg>`;
  const box = new Resvg(svg, { font: FONT }).getBBox();
  return box ? box.width : text.length * size * 0.56;
}

export type FooterSpec = {
  gradient: [string, string, string];
  columns: { icon: keyof typeof ICONS; text: string }[];
  vetLine?: string; // only for product-related posts
  vetColor?: string;
};

export function footerSvg(spec: FooterSpec): string {
  const colW = (W - PAD * 2) / spec.columns.length;
  const ICON = 24, GAP = 10, cy = STRIP_Y + STRIP_H / 2;
  const cols = spec.columns.map((c, i) => {
    const tw = textWidth(c.text, 21, 600);
    const groupW = ICON + GAP + tw;
    const x0 = PAD + i * colW + (colW - groupW) / 2;
    return `<g fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" transform="translate(${x0.toFixed(1)} ${(cy - ICON / 2).toFixed(1)})">${ICONS[c.icon]}</g>` +
      `<text x="${(x0 + ICON + GAP).toFixed(1)}" y="${(cy + 7.5).toFixed(1)}" font-family="Inter" font-size="21" font-weight="600" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="0.45">${esc(c.text)}</text>`;
  });
  const dividers = spec.columns.slice(1).map((_, i) => {
    const x = PAD + (i + 1) * colW;
    return `<line x1="${x}" y1="${STRIP_Y + 16}" x2="${x}" y2="${STRIP_Y + STRIP_H - 16}" stroke="#FFFFFF" stroke-opacity="0.55" stroke-width="1.5"/>`;
  });
  const vet = spec.vetLine
    ? `<text x="${W / 2}" y="${STRIP_Y - 16 - 5}" text-anchor="middle" font-family="Inter" font-size="20" font-weight="400" fill="${spec.vetColor ?? "#4A4547"}">${esc(spec.vetLine)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="strip" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${spec.gradient[0]}"/><stop offset="0.5" stop-color="${spec.gradient[1]}"/><stop offset="1" stop-color="${spec.gradient[2]}"/>
    </linearGradient>
    <filter id="shadow" x="-5%" y="-50%" width="110%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
  </defs>
  ${vet}
  <rect x="0" y="${STRIP_Y + 6}" width="${W}" height="${STRIP_H}" fill="#000000" fill-opacity="0.22" filter="url(#shadow)"/>
  <rect x="0" y="${STRIP_Y}" width="${W}" height="${STRIP_H}" fill="url(#strip)"/>
  ${dividers.join("")}
  ${cols.join("")}
</svg>`;
}

/** Composites the exact footer onto a 1080×1350 post. */
export async function applyFooter(post: Buffer, spec: FooterSpec): Promise<Buffer> {
  const overlay = new Resvg(footerSvg(spec), { font: FONT, background: "rgba(0,0,0,0)" }).render().asPng();
  return sharp(await sharp(post).resize(W, H, { fit: "cover" }).png().toBuffer()).composite([{ input: overlay, top: 0, left: 0 }]).png().toBuffer();
}

export const TAD_FOOTER: FooterSpec = {
  gradient: ["#A30F15", "#ED1C24", "#FF4A4F"],
  columns: [
    { icon: "phone", text: "0300 4307810" },
    { icon: "whatsapp", text: "+92 300 4307810" },
    { icon: "mail", text: "info@tadpharma.pk" },
    { icon: "globe", text: "tadpharma.pk" },
  ],
};
export const TAD_VET_LINE = "Vet — Not for human use. Veterinary use only.";

// Quick preview: npx tsx <this file> <out.png>
if (process.argv[1]?.endsWith("footer.ts") && process.argv[2]) {
  (async () => {
    const blank = await sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const png = await applyFooter(blank, { ...TAD_FOOTER, vetLine: TAD_VET_LINE });
    await sharp(png).extract({ left: 0, top: 1180, width: W, height: 170 }).toFile(process.argv[2]);
    console.log("ok");
  })();
}
