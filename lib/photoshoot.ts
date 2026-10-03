import "server-only";
import { db } from "./supabase/db";
import { getBrand, type Brand } from "./brands";
import { getPlacement, type Placement } from "./placements";
import { generateAndRecord, runGenerationBatch, type GenerationBatchInput } from "./generate-batch";
import { expectedTextFromPrompt, expectedTextOf, GLOBAL_DESIGN_RULE, renderContract, type PromptContract } from "./prompt-contract";
import { loadBrandLogo } from "./references";
import { getGeneration, type Generation } from "./generations";
import type { Delivery, Provider, Tier } from "./image-providers";
import { getPhotoshootMode, withDefaultAnswers, type PhotoshootMode, type PhotoshootModeId } from "./photoshoot-modes";

/**
 * Product Photoshoot (2026-10-03): explore cheap → approve → final, the AI
 * Content Factory pattern (Rana642/ai-content-factory) on the ten modes from
 * Higgsfield's product-photoshoot skill. Concepts are always Draft quality;
 * an approved concept is rendered again at Standard/Premium with the concept
 * itself as image 1, so the final keeps its composition. Every image goes
 * through the vision quality gate.
 */

type Img = { base64: string; mimeType: string };

/** Variants differ in light, angle and palette — never paraphrased copies
 *  of one image (Higgsfield's multi-variant rule). */
const VARIANTS = [
  { light: "soft diffused window light", angle: "straight-on at eye level", palette: "clean whites and soft greys" },
  { light: "crisp studio key light with a soft rim light", angle: "three-quarter view from slightly above", palette: "brand-colour accents on a light backdrop" },
  { light: "warm golden-hour light", angle: "low hero angle", palette: "warm natural tones" },
  { light: "bright high-key light", angle: "top-down flat lay", palette: "fresh pastel tones" },
  { light: "gentle overhead softbox with soft shadows", angle: "close three-quarter with shallow depth of field", palette: "soft neutral beige and cream" },
];

const BACKDROP: Record<string, string> = {
  white: "a seamless pure white background",
  grey: "a soft light-grey seamless backdrop",
  brand: "a seamless backdrop in a light tint of the brand colour",
  marble: "a light marble / stone surface",
  wood: "a light natural wooden tabletop",
};
const LOOK: Record<string, string> = {
  ecommerce: "clean e-commerce catalog style, even light, true colours",
  editorial: "premium editorial product photography with refined props kept minimal",
  shadow: "minimal composition with graphic soft shadows and light play",
};
const PLACE: Record<string, string> = {
  farm: "a clean, modern poultry / livestock farm (healthy animals in the soft-focus background)",
  kitchen: "a bright, tidy kitchen counter",
  shop: "a neat shop or pharmacy shelf with soft-focus shelves behind",
  office: "a tidy modern office desk",
  outdoor: "a fresh outdoor garden setting",
  home: "a bright, comfortable home living room",
};
const MOOD: Record<string, string> = {
  morning: "bright, fresh morning light",
  airy: "clean, airy, high-key light",
  golden: "warm golden-hour light",
  festive: "light, festive Eid / Ramadan touches (soft lanterns, crescent motifs) kept subtle and bright",
  summer: "fresh, sunny summer light",
};
const ACTION: Record<string, string> = {
  holding: "hands holding the product naturally towards the camera",
  using: "hands pouring or using the product",
  opening: "hands opening the pack",
  mixing: "hands mixing or applying the product",
};
const HANDS: Record<string, string> = {
  farmer: "a farmer's clean, working hands",
  gloves: "a professional's hands in clean gloves",
  everyday: "clean everyday hands",
};
const AESTHETIC: Record<string, string> = {
  minimal: "clean and minimal",
  cozy: "warm and cozy",
  natural: "fresh and natural",
  bold: "bold and colourful",
  luxury: "quiet luxury — refined, understated",
};
const USE: Record<string, string> = { website: "a website header", facebook: "a Facebook cover", campaign: "a campaign banner" };
const SPACE: Record<string, string> = {
  left: "the product on the right third, generous clean space on the left for a headline",
  right: "the product on the left third, generous clean space on the right for a headline",
  centre: "the product centred with balanced space around it",
};
const STORY: Record<string, string[]> = {
  tour: ["the hero shot of the product", "a close-up of the label and texture", "the product in its real setting", "a key benefit shown visually", "the product with its packaging", "a detail of how it is used", "a closing hero shot"],
  problem: ["the problem it solves, shown gently (no suffering)", "the product as the answer", "the product in use", "the result after using it", "the product hero shot", "a detail of the product", "a closing hero shot"],
  howto: ["step 1 — the product ready to use", "step 2 — preparing / measuring", "step 3 — using it", "step 4 — the result", "the product hero shot", "a detail of the dose / measure", "a closing hero shot"],
  range: ["the full range together", "the hero product", "a second product", "a third product", "the range on a shelf", "a detail shot", "a closing range shot"],
};
const GOAL: Record<string, string> = {
  sales: "a strong product hero with clear space for an offer",
  awareness: "an eye-catching brand moment that makes the product memorable",
  leads: "a trustworthy, professional look that invites an enquiry",
};
const AD_ANGLES = ["the product hero with bold clear space", "the product in real use", "a close-up detail with space for a benefit"];
const MODEL: Record<string, string> = {
  man: "a young Pakistani man",
  woman: "a young Pakistani woman in modest clothing",
  worker: "a Pakistani farmer / worker in clean work clothes",
  professional: "a Pakistani professional (doctor / vet) in a clean coat",
};
const SETTING: Record<string, string> = { studio: "a clean studio", outdoor: "a natural outdoor setting", workplace: "a real workplace", home: "a bright home" };
const CONCEPT: Record<string, string> = {
  floating: "the product floating in mid-air with a soft shadow below",
  splash: "a frozen crystal-clear water splash around the product",
  ingredients: "its key ingredients bursting outward around the product",
  pedestal: "the product on a sculptural pedestal like a museum piece",
  nature: "a surreal, dreamy nature scene around the product",
};
const RESTYLE: Record<string, string> = {
  bright: "clean and bright",
  luxury: "quiet luxury",
  eid: "festive Eid — light, joyful, crescent and lantern touches",
  ramadan: "Ramadan — soft, luminous twilight with lanterns (light, never dark)",
  azadi: "Pakistan Independence Day — green and white, flags and confetti, bright",
  summer: "fresh summer",
  winter: "warm, cozy winter",
};

type BuildCtx = {
  mode: PhotoshootMode;
  answers: Record<string, string>;
  brand: Brand | null;
  note?: string;
  text?: { headline?: string; cta?: string };
  productCount: number;
  hasLogo: boolean;
};

/** The contract for image i of n in this photoshoot. */
export function buildContract(ctx: BuildCtx, i: number, n: number, placement: Placement): PromptContract {
  const { mode, answers: a, brand } = ctx;
  const v = VARIANTS[i % VARIANTS.length];
  const brandName = brand ? `"${brand.name}"` : "the brand";
  const productLock = `PRODUCT LOCK — the product in ${ctx.productCount > 1 ? `images 1–${ctx.productCount}` : "image 1"} is the hero: keep it identical — same shape, cap, colours, label layout, logo and label text; never invent new words on the pack; natural, physically correct scale with a real contact shadow and reflections.`;
  const lines: { role: string; text: string }[] = [];
  if (ctx.text?.headline) lines.push({ role: "headline", text: ctx.text.headline });
  if (ctx.text?.cta) lines.push({ role: "call-to-action in a glossy pill button", text: ctx.text.cta });

  let scene = "";
  let composition = `${placement.label}; the product is the clear focal point, ${v.angle}; uncluttered.`;
  let background = "";
  let keyElements: string | undefined;
  let subjects: string | undefined = productLock;

  switch (mode.id as PhotoshootModeId) {
    case "product_shot":
      scene = `Studio product photograph of ${brandName}'s product — ${LOOK[a.look]}.`;
      background = `${BACKDROP[a.backdrop]}, with a soft floor shadow.`;
      break;
    case "lifestyle_scene":
      scene = `The product in ${PLACE[a.place]}, naturally placed where it is really used, ${MOOD[a.mood]}.`;
      background = `${PLACE[a.place]} in soft focus behind the product, shallow depth of field.`;
      break;
    case "closeup_with_hands":
      scene = `Tight close-up: ${ACTION[a.action]} — ${HANDS[a.hands]}; only hands and forearms in frame, no faces.`;
      background = "A clean, softly blurred real setting.";
      break;
    case "moodboard_pin":
      scene = `A tall, Pinterest-native styled photograph of the product — ${AESTHETIC[a.aesthetic]} mood, curated props kept few.`;
      background = `A styled surface and backdrop matching the ${AESTHETIC[a.aesthetic]} mood.`;
      break;
    case "hero_banner":
      scene = `A wide hero image for ${USE[a.use]} featuring the product.`;
      composition = `Wide 16:9 banner: ${SPACE[a.space]}; ${v.angle}.`;
      background = "A clean, bright, wide scene with gentle depth that continues behind the text space.";
      break;
    case "social_carousel": {
      const beats = STORY[a.story];
      scene = `Slide ${i + 1} of ${n} of an Instagram carousel telling one story: ${beats[i % beats.length]}.`;
      keyElements = "VISUAL SYSTEM LOCK across all slides: the same background family, light and palette on every slide so they read as one set.";
      if (a.story === "range") subjects = "The products shown must match the attached product photo(s) exactly — same packs, colours and label text.";
      break;
    }
    case "ad_creative_pack":
      scene = `Ad variant ${i + 1} of ${n} for paid social: ${GOAL[a.goal]} — ${AD_ANGLES[i % AD_ANGLES.length]}.`;
      background = "A bright, scroll-stopping but clean backdrop.";
      break;
    case "virtual_model":
      scene = `${MODEL[a.model]} naturally using or holding the product in ${SETTING[a.setting]}; a relaxed, genuine expression; culturally appropriate, modest clothing for a Pakistani audience. An AI-generated person, not a real or famous individual.`;
      background = `${SETTING[a.setting]}, softly blurred.`;
      break;
    case "conceptual_product":
      scene = `A conceptual, CGI-style hero shot: ${CONCEPT[a.concept]}.`;
      background = "A clean, light gradient backdrop that makes the effect pop.";
      break;
    case "restyle":
      subjects = a.keep === "all"
        ? "Keep image 1's subject, products, layout and any text exactly; change only the mood, light, season and styling."
        : "Keep image 1's layout and its products exactly; replace the background and surroundings with the new look.";
      scene = `Restyle image 1 into a ${RESTYLE[a.aesthetic]} look.`;
      background = "The new look's setting — light and bright.";
      break;
  }
  if (ctx.note) scene += ` Extra direction: ${ctx.note}`;

  const references: PromptContract["references"] = [
    ...Array.from({ length: ctx.productCount }, () => ({ role: (mode.input === "source" ? "source" : "product") as "source" | "product" })),
    ...(ctx.hasLogo ? [{ role: "logo" as const }] : []),
  ];
  return {
    frame: `Premium commercial product photography for ${brandName} — photo-real, tack sharp, magazine quality.`,
    scene,
    text: lines.length ? lines : "none",
    subjects,
    keyElements,
    logo: ctx.hasLogo ? `Place the attached logo (image ${ctx.productCount + 1}) small and clean in a corner, exactly as supplied.` : undefined,
    composition,
    background: background || "A bright, clean backdrop.",
    lighting: `${v.light}; natural, believable highlights on the product.`,
    grade: `Rich but natural colours (${v.palette}); crisp detail; polished commercial finish.`,
    brand: [
      brand ? `Brand palette accents where it fits: ${[brand.primary_hex, brand.secondary_hex, brand.accent_hex].filter(Boolean).join(", ")}.` : "",
      lines.length ? GLOBAL_DESIGN_RULE : "Light and bright overall — never a dark or black background.",
    ]
      .filter(Boolean)
      .join(" "),
    references,
  };
}

/** Photoshoot inputs are kept so a concept can be finalised later. */
async function storeInputs(batchId: string, images: Img[]): Promise<string[]> {
  return Promise.all(
    images.map(async (img, i) => {
      const ext = img.mimeType.split("/")[1] || "png";
      const path = `photoshoot-inputs/${batchId}/input-${i + 1}.${ext}`;
      const { error } = await db.storage.from("generations").upload(path, Buffer.from(img.base64, "base64"), { contentType: img.mimeType, upsert: true });
      if (error) throw error;
      return db.storage.from("generations").getPublicUrl(path).data.publicUrl;
    })
  );
}

async function fetchImg(url: string): Promise<Img> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status}).`);
  return { base64: Buffer.from(await res.arrayBuffer()).toString("base64"), mimeType: (res.headers.get("content-type") || "image/png").split(";")[0] };
}

/** Before the photoshoot SQL is run, the new track / columns are missing. */
function photoshootHint(err: unknown): Error {
  const m = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
  return /photoshoot|input_image_urls|parent_generation_id|approved_at|enum generation_track|tier/.test(m) && /column|schema|enum|invalid input/i.test(m)
    ? new Error('Photoshoot needs its database columns first — run the "Product Photoshoot" SQL from supabase-schema.sql in the Supabase SQL Editor.')
    : err instanceof Error
      ? err
      : new Error(m);
}

export type PhotoshootInput = {
  mode: PhotoshootModeId;
  images: Img[];
  brandId?: string | null;
  answers?: Record<string, string>;
  note?: string;
  text?: { headline?: string; cta?: string };
  count?: number;
  provider: Provider;
  qualityCheck?: boolean;
};

/** Step 1 — Draft concepts (cheap), one per variant, all under one batch id. */
export async function runPhotoshoot(input: PhotoshootInput): Promise<{ batchId: string; results: Generation[] }> {
  const mode = getPhotoshootMode(input.mode);
  if (!mode) throw new Error(`Unknown photoshoot mode "${input.mode}".`);
  if (input.images.length === 0) throw new Error(mode.input === "source" ? "Add the image to restyle." : "Add at least one product photo.");
  const brand = input.brandId ? await getBrand(input.brandId) : null;
  if (input.brandId && !brand) throw new Error("Brand not found.");
  const count = mode.counts.includes(input.count ?? 0) ? input.count! : mode.counts[0];
  const answers = withDefaultAnswers(mode, input.answers);
  const text = input.text?.headline || input.text?.cta ? input.text : undefined;
  const logo = text && brand ? await loadBrandLogo(brand.logo_url) : null;
  const images = input.images.slice(0, 3);

  const batchId = crypto.randomUUID();
  const inputUrls = await storeInputs(batchId, images);
  const ctx: BuildCtx = { mode, answers, brand, note: input.note, text, productCount: images.length, hasLogo: Boolean(logo) };
  const referenceImages = [...images, ...(logo ? [logo] : [])];

  const results = await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const placement = getPlacement(mode.placements[i % mode.placements.length])!;
      const contract = buildContract(ctx, i, count, placement);
      const job: GenerationBatchInput = {
        brandId: input.brandId ?? null,
        prompt: renderContract(contract),
        provider: input.provider,
        tier: "draft",
        placements: [placement],
        referenceImages,
        track: "photoshoot",
        contract,
        expectedText: expectedTextOf(contract),
        qualityCheck: input.qualityCheck,
        qualityRules: text ? GLOBAL_DESIGN_RULE : "Light and bright overall — never a dark or black background.",
        extraRow: { photoshoot_mode: mode.id, tier: "draft", input_image_urls: inputUrls },
      };
      return generateAndRecord(job, placement, batchId);
    })
  );
  const blocked = results.find((r) => r.status === "failed" && r.error_message && /photoshoot|input_image_urls|tier|enum/i.test(r.error_message));
  if (blocked) throw photoshootHint(new Error(blocked.error_message ?? ""));
  return { batchId, results };
}

export async function approveConcept(id: string, approved: boolean): Promise<void> {
  const { error } = await db.from("generations").update({ approved_at: approved ? new Date().toISOString() : null }).eq("id", id);
  if (error) throw photoshootHint(error);
}

const providerOfModel = (model: string | null): Provider => (model?.startsWith("gemini") ? "nano-banana" : "gpt-image");

/** Step 3 — the final of each approved concept, at Standard/Premium, with the
 *  concept as image 1 so the composition carries over. Marks it approved. */
export async function finalizeConcepts(input: {
  conceptIds: string[];
  tier: Exclude<Tier, "draft">;
  delivery?: Delivery;
  provider?: Provider;
  qualityCheck?: boolean;
}): Promise<Generation[]> {
  const out: Generation[] = [];
  for (const id of input.conceptIds) {
    const concept = await getGeneration(id);
    if (!concept || concept.status !== "complete" || !concept.image_url) throw new Error(`Concept ${id} is not a finished image.`);
    const row = concept as Generation & { photoshoot_mode?: string; input_image_urls?: string[] | null };
    await approveConcept(id, true);
    const inputs = await Promise.all((row.input_image_urls ?? []).map(fetchImg));
    const conceptImg = await fetchImg(concept.image_url);
    const placement = getPlacement(concept.placement)!;
    const isRestyle = row.photoshoot_mode === "restyle";
    // The concept becomes image 1, so every "image N" in its prompt moves up by one.
    const conceptPrompt = (concept.prompt_used ?? "")
      .replace(/^IMAGE REFERENCES:[^\n]*\n/, "")
      .replace(/\bimages (\d+)–(\d+)\b/g, (_, a, b) => `images ${Number(a) + 1}–${Number(b) + 1}`)
      .replace(/\bimage (\d+)\b/g, (_, n) => `image ${Number(n) + 1}`);
    const manifest = renderContract({
      frame: "",
      scene: "",
      text: [],
      composition: "",
      background: "",
      lighting: "",
      grade: "",
      references: [{ role: "concept" }, ...inputs.map(() => ({ role: (isRestyle ? "source" : "product") as "source" | "product" }))],
    }).split("\n")[0];
    const prompt = `${manifest}\nFINAL RENDER: re-create image 1 (the approved concept) at the highest quality — same composition, camera angle, layout, colours and text; sharper product with its real label from image 2, cleaner light, refined detail.\n\n${conceptPrompt}`;
    const result = await runGenerationBatch({
      brandId: concept.brand_id,
      prompt,
      provider: input.provider ?? providerOfModel(concept.model_used),
      tier: input.tier,
      placements: [placement],
      referenceImages: [conceptImg, ...inputs],
      track: "photoshoot",
      delivery: input.delivery,
      expectedText: expectedTextFromPrompt(concept.prompt_used ?? ""),
      qualityCheck: input.qualityCheck,
      qualityRules: (concept.prompt_used ?? "").includes(GLOBAL_DESIGN_RULE) ? GLOBAL_DESIGN_RULE : "Light and bright overall — never a dark or black background.",
      extraRow: { photoshoot_mode: row.photoshoot_mode, tier: input.tier, input_image_urls: row.input_image_urls, parent_generation_id: concept.id },
    }).catch((e) => {
      throw photoshootHint(e);
    });
    out.push(...result.results);
  }
  return out;
}

export type PhotoshootRow = Generation & {
  photoshoot_mode: string | null;
  tier: string | null;
  approved_at: string | null;
  parent_generation_id: string | null;
  input_image_urls: string[] | null;
};

export type PhotoshootGroup = {
  batchId: string;
  mode: string | null;
  brandId: string | null;
  createdAt: string;
  concepts: (PhotoshootRow & { finals: PhotoshootRow[] })[];
};

/** Recent photoshoots, newest first: each concept with its finals. */
export async function listRecentPhotoshoots(limit = 10): Promise<PhotoshootGroup[]> {
  const { data, error } = await db
    .from("generations")
    .select("*")
    .eq("track", "photoshoot")
    .order("created_at", { ascending: false })
    .limit(400);
  if (error) throw photoshootHint(error);
  const rows = (data ?? []) as PhotoshootRow[];
  const finals = rows.filter((r) => r.parent_generation_id);
  const groups = new Map<string, PhotoshootGroup>();
  for (const r of rows.filter((x) => !x.parent_generation_id)) {
    const g = groups.get(r.batch_id) ?? { batchId: r.batch_id, mode: r.photoshoot_mode, brandId: r.brand_id, createdAt: r.created_at, concepts: [] };
    g.concepts.push({ ...r, finals: finals.filter((f) => f.parent_generation_id === r.id).sort((a, b) => a.created_at.localeCompare(b.created_at)) });
    groups.set(r.batch_id, g);
  }
  for (const g of groups.values()) g.concepts.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return [...groups.values()].slice(0, limit);
}
