import "server-only";
import type { Brand } from "./brands";
import type { Copy } from "./copywriting";
import { GLOBAL_DESIGN_RULE, renderContract, type PromptContract } from "./prompt-contract";

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

/** Creative Track contract — shared by /api/generate and the MCP generate
 *  tool. `hasLogo` = the brand logo is attached as the first image;
 *  `styleRefCount` = how many existing brand graphics follow it. */
export function buildImageContract(
  brand: Brand,
  colors: string[],
  copy: Copy,
  opts: { offer?: string; hasLogo?: boolean; styleRefCount?: number } = {}
): PromptContract {
  const footer = buildFooterLine(brand);
  const text = [
    { role: "small badge label near the top", text: copy.label.toUpperCase() },
    { role: "bold main headline", text: copy.hook },
    { role: "call-to-action inside a glossy pill button", text: copy.cta.toUpperCase() },
    ...(footer ? [{ role: "small contact line in a thin footer band at the bottom edge", text: footer }] : []),
  ];
  return {
    frame: `Professional, scroll-stopping social media marketing graphic for the brand "${brand.name}" — poster-grade, one clear focal point, filling the whole frame.`,
    scene: [opts.offer ? `Campaign: ${opts.offer}.` : "", brand.about ? `The brand: ${brand.about}.` : ""].filter(Boolean).join(" ") || `A campaign graphic for ${brand.name}.`,
    text,
    keyElements: "One hero visual that shows the campaign idea at a glance; the badge label as a small pill near the top; the call-to-action as a glossy pill button.",
    logo: opts.hasLogo ? "Place the attached logo (image 1) small and clean in a top corner, exactly as supplied." : undefined,
    composition: "Clear hierarchy: headline largest, then the hero visual, then the button; generous margins; text never covers the hero subject; balanced, uncluttered.",
    background: "A bright scene or a soft light gradient built from the brand palette, with gentle depth.",
    lighting: "Soft, bright, premium light; tack-sharp details and crisp edges.",
    grade: "Clean, vivid but natural colours; polished commercial finish; cohesive as one image.",
    brand: [
      `Strict colour palette: ${colors.filter(Boolean).join(", ")}.`,
      brand.voice_notes ? `Visual style / vibe: ${brand.voice_notes}.` : "",
      GLOBAL_DESIGN_RULE,
    ]
      .filter(Boolean)
      .join(" "),
    references: [
      ...(opts.hasLogo ? [{ role: "logo" as const }] : []),
      ...Array.from({ length: opts.styleRefCount ?? 0 }, () => ({ role: "style" as const })),
    ],
  };
}

export function buildImagePrompt(brand: Brand, colors: string[], copy: Copy, opts?: Parameters<typeof buildImageContract>[3]): string {
  return renderContract(buildImageContract(brand, colors, copy, opts));
}

/** Subject-Preserving Edit track: the subject in image 1 (a person or
 *  product) must not be redrawn — only the scene around it changes. The
 *  identity lock follows Higgsfield's thumbnail skill wording. */
export function buildSubjectEditContract(sceneDescription: string): PromptContract {
  return {
    frame: "Photo-real composite: the real subject from image 1 placed naturally into a brand-new scene.",
    scene: sceneDescription,
    text: "none",
    subjects:
      "IDENTITY LOCK — reproduce the subject from image 1 with a photographic identity match. A person keeps the same face, bone structure, eye shape, nose, lips, jawline, skin tone, hairline, hair texture, expression and clothing — do not beautify, average or restyle the face. A product keeps its exact shape, colours, proportions and label text. Change only what is around the subject.",
    composition: "The subject is the clear hero, sharply in focus, with natural scale for the scene.",
    background: "The new scene from the description; bright and airy unless the description asks for another mood.",
    lighting: "Light the subject to match the new scene naturally — consistent direction, colour and soft contact shadows, so it looks photographed there.",
    grade: "Natural, cohesive, high-end photographic finish; tack sharp.",
    references: [{ role: "subject" }],
  };
}

export function buildSubjectEditPrompt(sceneDescription: string): string {
  return renderContract(buildSubjectEditContract(sceneDescription));
}
