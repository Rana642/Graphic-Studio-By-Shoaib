/**
 * Layout presets for "Exact text" designs: where the logo, badge label,
 * headline and CTA go on a canvas. Pure geometry (no I/O), in pixels, so the
 * same function serves the compose engine, a future live preview and tests.
 * One shared left edge (or one centre line), the headline block on a third
 * line, and a safe margin all round — the layout rules in the Knowledge Base.
 */

export const PRESETS = ["left", "center", "bottom"] as const;
export type Preset = (typeof PRESETS)[number];

export type Box = { x: number; y: number; w: number; h: number };

export type LayoutZones = {
  preset: Preset;
  width: number;
  height: number;
  align: "left" | "center";
  margin: number;
  /** Pixels kept free along the bottom edge (the contact strip). */
  footer: number;
  gap: number;
  logo: Box;
  label: Box;
  hook: Box;
  cta: Box;
};

const round = (n: number) => Math.round(n);

export function layoutFor(width: number, height: number, preset: Preset, footer = 0): LayoutZones {
  const short = Math.min(width, height);
  const margin = round(short * 0.07);
  const wide = width / height > 1.7;
  const align = preset === "center" ? "center" : "left";

  // Text column: the full width on a post, about 60% on a wide banner.
  const colW = wide ? round(width * 0.6) : width - margin * 2;
  const colX = align === "center" ? round((width - colW) / 2) : margin;

  const logoW = round(Math.min(width * 0.3, height * 0.28 * 3));
  const logoH = round(Math.min(height * 0.12, logoW * 0.5));
  const logo: Box = { x: align === "center" ? round((width - logoW) / 2) : margin, y: margin, w: logoW, h: logoH };

  // Vertical plan as fractions of the height: label, headline, CTA stacked with gaps.
  const hookTop = preset === "bottom" ? 0.5 : preset === "center" ? 0.34 : 0.3;
  const hookH = wide ? 0.4 : preset === "bottom" ? 0.24 : 0.26;
  const labelH = round(short * 0.055);
  const ctaH = round(short * 0.075);
  const gap = round(short * 0.03);

  const hook: Box = { x: colX, y: round(height * hookTop), w: colW, h: round(height * hookH) };
  const label: Box = { x: colX, y: hook.y - gap - labelH, w: colW, h: labelH };
  let cta: Box = { x: colX, y: hook.y + hook.h + gap, w: colW, h: ctaH };
  // Keep the CTA above the bottom margin; if it would spill, pull the whole block up.
  const overflow = cta.y + cta.h - (height - margin - footer);
  if (overflow > 0) {
    hook.y -= overflow;
    label.y -= overflow;
    cta = { ...cta, y: cta.y - overflow };
  }
  return { preset, width, height, align, margin, footer, gap, logo, label, hook, cta };
}
