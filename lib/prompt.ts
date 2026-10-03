import "server-only";
import type { Brand } from "./brands";
import type { Copy } from "./copywriting";

/** Contact/social line shown as a small footer band on generated graphics —
 *  only the fields Shoaib actually filled in, never invented placeholders. */
function buildFooterLine(brand: Brand): string | null {
  const parts = [
    brand.website_url,
    brand.contact_phone,
    brand.contact_email,
    brand.instagram_handle,
    brand.facebook_handle,
    brand.linkedin_handle,
    brand.tiktok_handle,
  ].filter((v): v is string => Boolean(v && v.trim()));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Shared by the web app's /api/generate route and the MCP server's
 *  generate tool — both hit the same image providers and must build the
 *  same prompt shape from a brand + copy. */
export function buildImagePrompt(brand: Brand, colors: string[], copy: Copy): string {
  const footer = buildFooterLine(brand);
  return [
    `Professional marketing graphic for the brand "${brand.name}".`,
    brand.about ? `About the brand: ${brand.about}.` : "",
    `Strict color palette: ${colors.filter(Boolean).join(", ")}.`,
    brand.voice_notes ? `Visual style/vibe: ${brand.voice_notes}.` : "",
    `Print the small badge label "${copy.label.toUpperCase()}" near the top.`,
    `Render the bold primary headline "${copy.hook}" with strong visual contrast, centered.`,
    `Place the call-to-action "${copy.cta.toUpperCase()}" inside a solid button-style shape near the bottom.`,
    footer
      ? `In a thin footer band at the very bottom edge, print this contact line in small, clean text: "${footer}".`
      : "",
    "Clean, premium layout. Do not add random decorative shapes, extra text, or misspelled words.",
    // Shoaib's global design rule for every brand (2026-10-03): light and glassy, never dark.
    "Light, professional look: bright photo scenes, white or soft light gradients; text on frosted-glass cards (white 60–75% opacity, background blur, thin white border, soft shadow, subtle glossy highlight). No dark or black backgrounds, panels, bands or overlays; dark colours only for text.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Subject-Preserving Edit track: the subject in the attached image (a
 *  person or product) must not be redrawn/altered — only the scene around
 *  it changes. The preservation framing is the whole point of this prompt;
 *  everything else is the user's own scene description. */
export function buildSubjectEditPrompt(sceneDescription: string): string {
  return [
    "Keep the main subject in the provided image exactly as it appears — if it's a person, preserve their face, features, proportions, expression, and clothing exactly; if it's a product, preserve its exact shape, colors, label text, and proportions.",
    "Do not alter, redraw, restyle, or regenerate the subject itself in any way.",
    `Only change the background, lighting environment, and surrounding scene: ${sceneDescription}`,
    "The subject should look naturally lit and composited into the new scene, but must remain visually identical to the source.",
  ].join(" ");
}
