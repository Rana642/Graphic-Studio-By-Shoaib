import fs from "node:fs";
import { generateImage } from "../../lib/image-providers/index.ts";
import { getPlacement } from "../../lib/placements.ts";
import { buildSubjectEditPrompt } from "../../lib/prompt.ts";
import { upscaleWithTopaz } from "../../lib/enhancers/topaz.ts";

const [SRC, OUT] = [process.argv[2]!, process.argv[3]!];
fs.mkdirSync(OUT, { recursive: true });
const photo = fs.readFileSync(SRC);
const placement = getPlacement("ig_feed")!;

const FACE =
  "Keep the man's face EXACTLY as in image 1: same face shape, eyes, eyebrows, nose, moustache, beard, hairline, hair, skin tone, calm confident expression and frontal pose. Natural skin texture (no smoothing), sharp eyes. His body proportions stay the same. ONLY his clothing and the background change.";
const looks = [
  { name: "D-navy-suit-light", scene: `${FACE} New clothing: a well-fitted modern charcoal-navy suit, crisp white shirt with an open collar, no tie. New scene: clean premium studio, soft warm off-white seamless backdrop with a faint citrus-yellow glow, soft even key light.` },
  { name: "E-black-turtleneck-office", scene: `${FACE} New clothing: a fitted black blazer over a black turtleneck, no tie, minimal and sharp. New scene: bright modern office softly blurred behind him with large windows and daylight, shallow depth of field.` },
  { name: "F-smart-casual-dark", scene: `${FACE} New clothing: a dark navy blazer over a light-blue open-collar shirt, smart casual, no tie. New scene: dark premium studio with a deep near-black backdrop, a soft warm rim light on his shoulders and hair, faint warm citrus glow.` },
];

let total = 0;
for (const s of looks) {
  const r = await generateImage("gpt-image", {
    prompt: buildSubjectEditPrompt(s.scene),
    tier: "standard",
    placement,
    referenceImages: [{ base64: photo.toString("base64"), mimeType: "image/jpeg" }],
  });
  total += r.estCostUsd;
  const buf = Buffer.from(r.imageBase64, "base64");
  fs.writeFileSync(`${OUT}/${s.name}.png`, buf);
  const up = await upscaleWithTopaz({ imageBuffer: buf, mimeType: "image/png", outputWidth: 2048, outputHeight: 3072 }, "Standard V2");
  fs.writeFileSync(`${OUT}/${s.name}-std.png`, up.imageBuffer);
  total += up.estCostUsd;
  console.log(s.name, "ok");
}
console.log("total est", total.toFixed(3));
