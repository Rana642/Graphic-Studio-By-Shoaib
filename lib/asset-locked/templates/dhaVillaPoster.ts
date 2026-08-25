import type { AssetLockedTemplate } from "./types";
import { esc } from "./svg-utils";

const DEFAULT_ACCENT = "#0F4C35";
const DEFAULT_ACCENT_TEXT = "#F4E9C9";

/** Real estate poster layout — opaque top ~56% (logos, Urdu headline,
 *  banner, feature pills), fully transparent bottom ~44% so the real
 *  property photo/3D-render composites through untouched. Structure
 *  confirmed via the feasibility spike (matches Shoaib's DHA Multan /
 *  Avenza Avenue reference examples). */
export const dhaVillaPosterTemplate: AssetLockedTemplate = {
  id: "real_estate_poster",
  label: "Real Estate Poster",
  description:
    "Property photo/3D-render with Urdu headline, feature banners, and logo badges — for real estate listings.",
  canvasWidth: 1080,
  canvasHeight: 1350,
  fields: [
    { key: "headline", label: "Headline (Urdu)", kind: "urdu", maxLength: 80 },
    { key: "subheadline", label: "Subheadline (Urdu)", kind: "urdu", maxLength: 120 },
    { key: "bigWord", label: "Big display word (Urdu)", kind: "urdu", maxLength: 30 },
    { key: "bannerText", label: "Banner text (Urdu)", kind: "urdu", maxLength: 60 },
    { key: "feature1", label: "Feature 1", kind: "text", maxLength: 40 },
    { key: "feature2", label: "Feature 2", kind: "text", maxLength: 40 },
    { key: "sectorLabel", label: "Location label", kind: "text", maxLength: 60 },
    { key: "phone", label: "Phone / UAN", kind: "text", maxLength: 30 },
    { key: "website", label: "Website", kind: "text", maxLength: 60 },
  ],
  buildFrameSvg(values, brand) {
    const accent = brand?.primary_hex || DEFAULT_ACCENT;
    const brandInitial = (brand?.name?.trim()?.[0] || "A").toUpperCase();

    return `
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">
  <rect x="0" y="0" width="1080" height="760" fill="#FAF7F0"/>

  <circle cx="110" cy="90" r="55" fill="none" stroke="${accent}" stroke-width="4"/>
  <text x="110" y="82" font-family="Inter" font-size="13" font-weight="700" fill="${accent}" text-anchor="middle">DHA</text>
  <text x="110" y="100" font-family="Inter" font-size="13" font-weight="700" fill="${accent}" text-anchor="middle">MULTAN</text>

  <circle cx="970" cy="90" r="55" fill="none" stroke="${accent}" stroke-width="4"/>
  <text x="970" y="98" font-family="Inter" font-size="30" font-weight="700" fill="${accent}" text-anchor="middle">${esc(brandInitial)}</text>

  <text x="540" y="260" font-family="Noto Nastaliq Urdu" font-size="52" fill="#1A1A1A" text-anchor="middle">${esc(values.headline || "")}</text>
  <text x="540" y="330" font-family="Noto Nastaliq Urdu" font-size="30" fill="#3A3A3A" text-anchor="middle">${esc(values.subheadline || "")}</text>

  <text x="540" y="470" font-family="Noto Nastaliq Urdu" font-size="110" font-weight="700" fill="${accent}" text-anchor="middle">${esc(values.bigWord || "")}</text>

  <rect x="60" y="530" width="960" height="70" rx="12" fill="${accent}"/>
  <text x="540" y="576" font-family="Noto Nastaliq Urdu" font-size="30" fill="${DEFAULT_ACCENT_TEXT}" text-anchor="middle">${esc(values.bannerText || "")}</text>

  <rect x="60" y="630" width="460" height="60" rx="10" fill="${DEFAULT_ACCENT_TEXT}"/>
  <text x="290" y="668" font-family="Inter" font-size="22" font-weight="600" fill="${accent}" text-anchor="middle">${esc(values.feature1 || "")}</text>

  <rect x="560" y="630" width="460" height="60" rx="10" fill="${DEFAULT_ACCENT_TEXT}"/>
  <text x="790" y="668" font-family="Inter" font-size="22" font-weight="600" fill="${accent}" text-anchor="middle">${esc(values.feature2 || "")}</text>

  <text x="60" y="740" font-family="Inter" font-size="20" font-weight="600" fill="#1A1A1A">${esc(values.sectorLabel || "")}</text>

  <rect x="0" y="1290" width="1080" height="60" fill="${accent}"/>
  <text x="30" y="1328" font-family="Inter" font-size="22" font-weight="700" fill="#FFFFFF">${esc(values.phone || "")}</text>
  <text x="1050" y="1328" font-family="Inter" font-size="20" fill="${DEFAULT_ACCENT_TEXT}" text-anchor="end">${esc(values.website || "")}</text>
</svg>`;
  },
};
