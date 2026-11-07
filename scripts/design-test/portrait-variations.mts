import fs from "node:fs";
import { generateImage } from "../../lib/image-providers/index.ts";
import { getPlacement } from "../../lib/placements.ts";
import { buildSubjectEditPrompt } from "../../lib/prompt.ts";
import { upscaleWithTopaz } from "../../lib/enhancers/topaz.ts";

const [SRC, OUT] = [process.argv[2]!, process.argv[3]!];
fs.mkdirSync(OUT, { recursive: true });
const photo = fs.readFileSync(SRC);
const placement = getPlacement("ig_feed")!; // 1024x1536 portrait

const KEEP =
  "Keep the man's face, hair, beard, moustache, expression, skin tone, body proportions and his exact checked brown-and-black suit, cream shirt, burgundy tie, burgundy pocket square and small gold key lapel pin EXACTLY as in image 1. Frontal, calm, confident, professional pose exactly as in image 1. Only the background and the lighting change. Natural skin texture (no smoothing, no plastic retouch), sharp eyes.";
const scenes = [
  { name: "A-light-studio", scene: `${KEEP} New scene: a clean premium photo studio with a soft warm off-white seamless backdrop and a very subtle warm citrus-yellow glow behind his shoulders; soft even key light with a gentle rim light; shallow, clean, professional corporate portrait look.` },
  { name: "B-modern-office", scene: `${KEEP} New scene: a bright modern office interior softly blurred behind him (large windows, daylight, light wood and white surfaces), natural window light on his face, shallow depth of field, editorial business portrait look.` },
  { name: "C-dark-studio", scene: `${KEEP} New scene: a dark premium studio with a deep near-black ink backdrop, a soft warm rim light outlining his shoulders and hair, a faint warm citrus-yellow glow in the background, cinematic but natural skin tones.` },
];

let total = 0;
for (const s of scenes) {
  const prompt = buildSubjectEditPrompt(s.scene);
  const r = await generateImage("gpt-image", {
    prompt,
    tier: "standard",
    placement,
    referenceImages: [{ base64: photo.toString("base64"), mimeType: "image/jpeg" }],
  });
  total += r.estCostUsd;
  const buf = Buffer.from(r.imageBase64, "base64");
  fs.writeFileSync(`${OUT}/${s.name}.png`, buf);
  console.log(s.name, "gpt", r.estCostUsd);
  try {
    const up = await upscaleWithTopaz({ imageBuffer: buf, mimeType: "image/png", outputWidth: 2048, outputHeight: 3072 }, "High Fidelity V2");
    fs.writeFileSync(`${OUT}/${s.name}-topaz.png`, up.imageBuffer);
    total += up.estCostUsd;
    console.log(s.name, "topaz", up.estCostUsd);
  } catch (e) {
    console.log(s.name, "topaz FAILED", (e as Error).message.slice(0, 200));
  }
}
console.log("total est", total.toFixed(3));
