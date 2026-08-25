import type { AssetLockedTemplate } from "./types";
import { esc } from "./svg-utils";

const DEFAULT_ACCENT = "#EAB308";

/** Full-bleed photo layout — the frame is fully transparent across the
 *  entire canvas except a bottom gradient band (for text legibility) and
 *  small corner badges, so the real photo shows through everywhere else.
 *  Matches Shoaib's "Realtors Meetup" event-photo reference example — event
 *  recaps, salon/portrait results, any photo where the whole frame (not
 *  just a bottom portion) should stay the real image. */
export const eventOverlayTemplate: AssetLockedTemplate = {
  id: "event_overlay",
  label: "Event / Portrait Overlay",
  description:
    "Full-bleed real photo (event recap, salon result, team photo) with a bottom gradient band, headline typography, and a logo badge.",
  canvasWidth: 1080,
  canvasHeight: 1350,
  fields: [
    { key: "topLabel", label: "Small top label (optional)", kind: "text", maxLength: 40 },
    { key: "tagline", label: "Small tagline above headline", kind: "text", maxLength: 60 },
    { key: "headline", label: "Headline", kind: "text", maxLength: 40 },
    { key: "subtitle", label: "Subtitle", kind: "text", maxLength: 40 },
  ],
  buildFrameSvg(values, brand) {
    const accent = brand?.accent_hex || brand?.primary_hex || DEFAULT_ACCENT;
    const brandName = brand?.name || "";

    return `
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">
  <defs>
    <linearGradient id="bandFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0A0A0A" stop-opacity="0"/>
      <stop offset="55%" stop-color="#0A0A0A" stop-opacity="0.75"/>
      <stop offset="100%" stop-color="#0A0A0A" stop-opacity="0.95"/>
    </linearGradient>
  </defs>

  ${values.topLabel ? `<text x="40" y="60" font-family="Inter" font-size="22" font-weight="600" fill="#FFFFFF">${esc(values.topLabel)}</text>` : ""}

  <rect x="0" y="950" width="1080" height="400" fill="url(#bandFade)"/>

  ${values.tagline ? `<text x="60" y="1080" font-family="Inter" font-size="20" font-weight="600" letter-spacing="3" fill="${accent}">${esc(values.tagline.toUpperCase())}</text>` : ""}
  <text x="55" y="1170" font-family="Inter" font-size="90" font-weight="800" fill="${accent}">${esc(values.headline || "")}</text>
  ${values.subtitle ? `<text x="65" y="1230" font-family="Inter" font-size="46" font-style="italic" fill="#FFFFFF">${esc(values.subtitle)}</text>` : ""}

  <circle cx="960" cy="1230" r="70" fill="#FFFFFF"/>
  <circle cx="960" cy="1230" r="70" fill="none" stroke="${accent}" stroke-width="3"/>
  <text x="960" y="1240" font-family="Inter" font-size="22" font-weight="700" fill="#1A1A1A" text-anchor="middle">${esc((brandName[0] || "").toUpperCase())}</text>
  ${brandName ? `<text x="960" y="1320" font-family="Inter" font-size="24" font-weight="700" fill="#FFFFFF" text-anchor="middle">${esc(brandName.toUpperCase())}</text>` : ""}
</svg>`;
  },
};
