import "server-only";

/**
 * Prompt Contract (2026-10-03) — every image prompt is assembled from the same
 * ordered blocks, adapted from Higgsfield's MIT-licensed skills
 * (github.com/higgsfield-ai/skills, youtube-thumbnail "Prompt contract" and
 * generate/prompt-engineering): a reference manifest first, then frame →
 * scene → text → subjects → key elements → logo → location → composition →
 * background → lighting → grade → brand. Concrete, sensory, positively
 * phrased ("tack sharp", not "no blur"). The exact on-image text is kept as
 * data too, so the quality gate can check it letter by letter.
 */

export type ReferenceRole = "logo" | "product" | "subject" | "style" | "concept" | "source";

export type TextLine = { role: string; text: string };

export type PromptContract = {
  /** What the image is, its format and its intent. */
  frame: string;
  /** The user's content: what the image shows / says. */
  scene: string;
  /** Exact words to print, or "none" for a text-free image. */
  text: TextLine[] | "none";
  subjects?: string;
  keyElements?: string;
  logo?: string;
  location?: string;
  composition: string;
  background: string;
  lighting: string;
  grade: string;
  /** Palette, voice and the global design rule. */
  brand?: string;
  /** Attached images, in the exact order they are sent to the provider. */
  references: { role: ReferenceRole; note?: string }[];
  /** Added by the quality gate on a retry: what to correct this time. */
  fix?: string;
};

const ROLE_TEXT: Record<ReferenceRole, string> = {
  logo: "the brand logo — reproduce its exact shapes, colours, proportions and letterforms; never redraw or restyle it",
  product: "the real product — keep it identical: same shape, colours, cap, label layout and label text",
  subject: "the real subject (person or product) — identity lock: reproduce it exactly as photographed",
  style: "an existing brand graphic — follow its style (colour use, layout feel, typography) only; do not copy its text, layout or objects",
  concept: "the approved concept — keep its composition, camera angle, layout, colours and any text exactly; render it again at the highest quality",
  source: "the image to restyle — keep its subject, products and layout; change only the mood, light, season and styling as described",
};

/** Global design rule for every brand (Shoaib, 2026-10-03): light and glassy, never dark. */
export const GLOBAL_DESIGN_RULE =
  "Light, professional look: bright photo scenes, white or soft light gradients; text on frosted-glass cards (white 60–75% opacity, background blur, thin white border, soft shadow, subtle glossy highlight). No dark or black backgrounds, panels, bands or overlays; dark colours only for text.";

export function renderContract(c: PromptContract): string {
  const blocks: string[] = [];
  if (c.references.length > 0) {
    blocks.push(
      `IMAGE REFERENCES: ${c.references
        .map((r, i) => `image ${i + 1} = ${ROLE_TEXT[r.role]}${r.note ? ` (${r.note})` : ""}`)
        .join("; ")}.`
    );
  }
  // With a real product in the shot its own printed label must survive, so
  // "no text" means no ADDED text there.
  const hasRealObject = c.references.some((r) => r.role !== "style" && r.role !== "logo");
  const textBlock =
    c.text === "none" || c.text.length === 0
      ? hasRealObject
        ? "No added text — no headline, caption, sticker or watermark. Any words printed on the product's own pack or label stay exactly as they are."
        : "No text, no readable labels, no watermark anywhere in the image."
      : `Print exactly these words and nothing else, spelled exactly as written (a line may wrap): ${c.text
          .map((t, i) => `${i + 1}) ${t.role}: "${t.text}"`)
          .join("; ")}. No other words, no lorem ipsum, no watermark.`;
  const numbered: [string, string | undefined][] = [
    ["FRAME", c.frame],
    ["SCENE", c.scene],
    ["TEXT", textBlock],
    ["SUBJECTS", c.subjects],
    ["KEY ELEMENTS", c.keyElements],
    ["LOGO", c.logo],
    ["LOCATION", c.location],
    ["COMPOSITION", c.composition],
    ["BACKGROUND", c.background],
    ["LIGHTING", c.lighting],
    ["GRADE", c.grade],
    ["BRAND", c.brand],
  ];
  let n = 0;
  for (const [label, value] of numbered) {
    if (value && value.trim()) blocks.push(`${++n}. ${label}: ${value.trim()}`);
  }
  if (c.fix) blocks.push(`FIX FROM REVIEW (most important this time): ${c.fix}`);
  return blocks.join("\n");
}

/** The exact words the image must contain — what the quality gate checks. */
export function expectedTextOf(c: PromptContract): string[] {
  return c.text === "none" ? [] : c.text.map((t) => t.text).filter(Boolean);
}

/** For a free prompt: the words the user put in quotes are the words that
 *  must appear on the image. */
export function quotedText(prompt: string): string[] {
  return [...prompt.matchAll(/["“]([^"”]{2,160})["”]/g)].map((m) => m[1].trim());
}

/** A free prompt stays the user's own words; with attached images it only
 *  gains the reference manifest so the model knows what each image is. */
export function withReferenceManifest(prompt: string, references: PromptContract["references"]): string {
  if (references.length === 0) return prompt;
  return `${renderContract({ frame: "", scene: "", text: [], composition: "", background: "", lighting: "", grade: "", references }).split("\n")[0]}\n\n${prompt}`;
}

/** The exact words a saved prompt asks for — the TEXT block of a contract
 *  prompt, or the quoted words of a free prompt. Used when only the stored
 *  prompt is left (batch results judged after the provider finishes). */
export function expectedTextFromPrompt(prompt: string): string[] {
  const textLine = prompt.split("\n").find((l) => /^\d+\. TEXT: /.test(l));
  if (textLine) return /^\d+\. TEXT: No text/.test(textLine) ? [] : quotedText(textLine);
  return quotedText(prompt);
}
