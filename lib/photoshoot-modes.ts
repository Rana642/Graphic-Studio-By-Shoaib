/**
 * Product Photoshoot modes (2026-10-03) — the ten modes of Higgsfield's
 * MIT-licensed product-photoshoot skill (github.com/higgsfield-ai/skills),
 * with their short labelled questions. Their prompt templates live on
 * Higgsfield's server, so ours are written fresh in lib/photoshoot.ts.
 * Plain data (no server imports) — shared by the form, the server and MCP.
 */

export type PhotoshootModeId =
  | "product_shot"
  | "lifestyle_scene"
  | "closeup_with_hands"
  | "moodboard_pin"
  | "hero_banner"
  | "social_carousel"
  | "ad_creative_pack"
  | "virtual_model"
  | "conceptual_product"
  | "restyle";

export type PhotoshootQuestion = { id: string; label: string; options: { value: string; label: string }[] };

export type PhotoshootMode = {
  id: PhotoshootModeId;
  label: string;
  /** One line for the mode card. */
  short: string;
  icon: string;
  /** Allowed "how many" choices; the first is the default. */
  counts: number[];
  /** Placement id per image (cycled when there are more images). */
  placements: string[];
  questions: PhotoshootQuestion[];
  /** Restyle works on an existing image, every other mode on product photos. */
  input: "product" | "source";
};

const q = (id: string, label: string, options: [string, string][]): PhotoshootQuestion => ({
  id,
  label,
  options: options.map(([value, label]) => ({ value, label })),
});

export const PHOTOSHOOT_MODES: PhotoshootMode[] = [
  {
    id: "product_shot",
    label: "Studio shot",
    short: "Clean studio / catalog photo of the product",
    icon: "📦",
    counts: [3, 1, 5],
    placements: ["square"],
    input: "product",
    questions: [
      q("backdrop", "Background", [["white", "Pure white"], ["grey", "Soft grey"], ["brand", "Brand colour"], ["marble", "Marble / stone"], ["wood", "Wooden top"]]),
      q("look", "Look", [["ecommerce", "Clean e-commerce"], ["editorial", "Premium editorial"], ["shadow", "Minimal with shadow play"]]),
    ],
  },
  {
    id: "lifestyle_scene",
    label: "Lifestyle",
    short: "The product in a real place where it is used",
    icon: "🏡",
    counts: [3, 1, 5],
    placements: ["ig_feed"],
    input: "product",
    questions: [
      q("place", "Where", [["farm", "Poultry / livestock farm"], ["kitchen", "Kitchen counter"], ["shop", "Shop / pharmacy shelf"], ["office", "Office desk"], ["outdoor", "Outdoors / garden"], ["home", "Home living room"]]),
      q("mood", "Mood", [["morning", "Bright morning"], ["airy", "Clean & airy"], ["golden", "Warm golden hour"], ["festive", "Festive (Eid / Ramadan)"], ["summer", "Fresh summer"]]),
    ],
  },
  {
    id: "closeup_with_hands",
    label: "In hand",
    short: "Close-up with hands holding or using the product",
    icon: "🤲",
    counts: [3, 1, 5],
    placements: ["ig_feed"],
    input: "product",
    questions: [
      q("action", "Action", [["holding", "Holding it"], ["using", "Pouring / using it"], ["opening", "Opening the pack"], ["mixing", "Mixing / applying"]]),
      q("hands", "Hands", [["farmer", "Farmer's hands"], ["gloves", "Professional with gloves"], ["everyday", "Everyday hands"]]),
    ],
  },
  {
    id: "moodboard_pin",
    label: "Pinterest pin",
    short: "Tall aesthetic image with a moodboard feel",
    icon: "📌",
    counts: [3, 1, 5],
    placements: ["pin"],
    input: "product",
    questions: [q("aesthetic", "Aesthetic", [["minimal", "Clean & minimal"], ["cozy", "Warm & cozy"], ["natural", "Fresh & natural"], ["bold", "Bold & colourful"], ["luxury", "Quiet luxury"]])],
  },
  {
    id: "hero_banner",
    label: "Hero banner",
    short: "Wide banner for a website, cover or campaign",
    icon: "🖥️",
    counts: [1, 3],
    placements: ["hero_wide"],
    input: "product",
    questions: [
      q("use", "Used for", [["website", "Website header"], ["facebook", "Facebook cover"], ["campaign", "Campaign banner"]]),
      q("space", "Text space", [["left", "Space on the left"], ["right", "Space on the right"], ["centre", "Centred product"]]),
    ],
  },
  {
    id: "social_carousel",
    label: "Carousel",
    short: "3–7 matching slides that tell one story",
    icon: "🎠",
    counts: [5, 3, 7],
    placements: ["ig_feed"],
    input: "product",
    questions: [q("story", "Story", [["tour", "Product tour"], ["problem", "Problem → solution"], ["howto", "How to use (steps)"], ["range", "Range overview"]])],
  },
  {
    id: "ad_creative_pack",
    label: "Ad pack",
    short: "Ad variants in feed and story sizes",
    icon: "📣",
    counts: [3, 6],
    placements: ["square", "ig_story", "ig_feed"],
    input: "product",
    questions: [q("goal", "Goal", [["sales", "Sales / offer"], ["awareness", "Awareness"], ["leads", "Enquiries / leads"]])],
  },
  {
    id: "virtual_model",
    label: "With a model",
    short: "An AI model wearing or using the product",
    icon: "🧍",
    counts: [3, 1, 5],
    placements: ["ig_feed"],
    input: "product",
    questions: [
      q("model", "Model", [["man", "Young man"], ["woman", "Young woman"], ["worker", "Farmer / worker"], ["professional", "Professional (doctor / vet)"]]),
      q("setting", "Setting", [["studio", "Clean studio"], ["outdoor", "Outdoor natural"], ["workplace", "Workplace"], ["home", "At home"]]),
    ],
  },
  {
    id: "conceptual_product",
    label: "Creative / CGI",
    short: "Floating, splash or sculptural hero shots",
    icon: "✨",
    counts: [3, 1, 5],
    placements: ["ig_feed"],
    input: "product",
    questions: [q("concept", "Idea", [["floating", "Floating in the air"], ["splash", "Water splash"], ["ingredients", "Ingredients bursting out"], ["pedestal", "Sculptural pedestal"], ["nature", "Surreal nature scene"]])],
  },
  {
    id: "restyle",
    label: "Restyle",
    short: "Give an existing image a new mood or season",
    icon: "🎨",
    counts: [3, 1, 5],
    placements: ["ig_feed"],
    input: "source",
    questions: [
      q("aesthetic", "New look", [["bright", "Clean & bright"], ["luxury", "Quiet luxury"], ["eid", "Festive Eid"], ["ramadan", "Ramadan"], ["azadi", "Independence Day (green & white)"], ["summer", "Summer fresh"], ["winter", "Winter cozy"]]),
      q("keep", "Keep", [["all", "Everything but the mood"], ["layout", "The layout, new background"]]),
    ],
  },
];

export function getPhotoshootMode(id: string): PhotoshootMode | undefined {
  return PHOTOSHOOT_MODES.find((m) => m.id === id);
}

/** Every question answered: the user's choice, else the first option. */
export function withDefaultAnswers(mode: PhotoshootMode, answers: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(
    mode.questions.map((qq) => [qq.id, qq.options.some((o) => o.value === answers[qq.id]) ? answers[qq.id] : qq.options[0].value])
  );
}
