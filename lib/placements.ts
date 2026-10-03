/**
 * One entry per output placement — the "Regular Track" one-click multi-size
 * flow fires a generation for every placement the user selects. Width/height
 * are the true target pixels; `providerSize` is what each provider's API
 * actually accepts (neither Gemini nor OpenAI's image APIs take arbitrary
 * WxH — they take a fixed list of sizes/aspect ratios), so the generated
 * image gets resized to the exact target via `sharp` after the API call.
 */
export type Placement = {
  id: string;
  label: string;
  width: number;
  height: number;
  /** Closest supported OpenAI gpt-image size string. */
  openaiSize: "1024x1024" | "1024x1536" | "1536x1024";
  /** Closest supported Gemini aspect ratio hint. */
  geminiAspectRatio: "1:1" | "2:3" | "3:4" | "4:3" | "4:5" | "9:16" | "16:9";
};

export const PLACEMENTS: Placement[] = [
  {
    id: "square",
    label: "Square Post (1:1)",
    width: 1080,
    height: 1080,
    openaiSize: "1024x1024",
    geminiAspectRatio: "1:1",
  },
  {
    id: "ig_feed",
    label: "Instagram / Facebook Feed (4:5)",
    width: 1080,
    height: 1350,
    openaiSize: "1024x1536",
    geminiAspectRatio: "3:4",
  },
  {
    id: "ig_story",
    label: "Instagram / Facebook Story (9:16)",
    width: 1080,
    height: 1920,
    openaiSize: "1024x1536",
    geminiAspectRatio: "9:16",
  },
  {
    id: "meta_ad",
    label: "Meta Landscape Ad (1.91:1)",
    width: 1200,
    height: 628,
    openaiSize: "1536x1024",
    geminiAspectRatio: "16:9",
  },
  {
    id: "linkedin_cover",
    label: "LinkedIn Cover (4:1)",
    width: 1584,
    height: 396,
    openaiSize: "1536x1024",
    geminiAspectRatio: "16:9",
  },
  {
    id: "fb_cover",
    label: "Facebook Cover (16:9)",
    width: 820,
    height: 360,
    openaiSize: "1536x1024",
    geminiAspectRatio: "16:9",
  },
  {
    id: "youtube_cover",
    label: "YouTube Channel Cover (16:9 wide)",
    width: 2560,
    height: 1440,
    openaiSize: "1536x1024",
    geminiAspectRatio: "16:9",
  },
];

/** Sizes used by the Product Photoshoot modes that the regular forms don't
 *  offer (kept out of PLACEMENTS so the size pickers stay short). */
export const EXTRA_PLACEMENTS: Placement[] = [
  {
    id: "pin",
    label: "Pinterest Pin (2:3)",
    width: 1000,
    height: 1500,
    openaiSize: "1024x1536",
    geminiAspectRatio: "2:3",
  },
  {
    id: "hero_wide",
    label: "Website / Campaign Hero (16:9)",
    width: 1920,
    height: 1080,
    openaiSize: "1536x1024",
    geminiAspectRatio: "16:9",
  },
];

export function getPlacement(id: string): Placement | undefined {
  return PLACEMENTS.find((p) => p.id === id) ?? EXTRA_PLACEMENTS.find((p) => p.id === id);
}
