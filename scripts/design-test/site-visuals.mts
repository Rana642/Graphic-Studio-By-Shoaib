import fs from "node:fs";
import sharp from "sharp";
import { generateImage } from "../../lib/image-providers/index.ts";
import { getPlacement } from "../../lib/placements.ts";

const OUT = process.argv[2]!;
const only = process.argv[3]?.split(",");
fs.mkdirSync(OUT, { recursive: true });

const STYLE =
  "Premium soft 3D render in a clean studio, glossy translucent glass and matte ink-black objects with bright citrus-yellow (#FEC107) accents, tiny touches of cobalt blue (#2196F3) and forest green (#3FA343), on a light off-white (#FAFAFA) background with soft realistic shadows. Modern SaaS marketing illustration, polished, cohesive, depth of field. STRICT: no text, no letters, no numbers, no logos, no watermark, no people.";

const jobs: { name: string; placement: string; prompt: string }[] = [
  { name: "hero-scene", placement: "hero_wide", prompt: `${STYLE} Scene: floating glass dashboard cards with abstract bar and line charts rising upward, a glossy citrus megaphone, a stack of gold coins and a target with an arrow, arranged mostly on the RIGHT 55% of the frame; the left 45% stays calm, empty and light.` },
  { name: "problem-leak", placement: "square", prompt: `${STYLE} Scene: a clear glass funnel with golden coins pouring in at the top, but several coins slip out through cracks in its side and fall away, while only a few reach the bottom. Centered, lots of empty space around.` },
  { name: "svc-meta", placement: "square", prompt: `${STYLE} Single hero object: a glossy citrus-yellow megaphone with small floating heart and thumbs-up bubbles (no text). Centered, empty space around.` },
  { name: "svc-google", placement: "square", prompt: `${STYLE} Single hero object: a big glass magnifying glass over a floating search bar shape (no text), with a small cobalt-blue pin. Centered, empty space around.` },
  { name: "svc-tracking", placement: "square", prompt: `${STYLE} Single hero object: a glass radar disc with connected glowing nodes and data points, small ink-black chip at the center. Centered, empty space around.` },
  { name: "svc-web", placement: "square", prompt: `${STYLE} Single hero object: a floating browser window with a simple wireframe page and a glossy citrus button, arrows flowing down into it like a funnel. Centered, empty space around.` },
  { name: "cta-band", placement: "hero_wide", prompt: "Dark premium abstract background: deep ink-black (#0F0F14) with soft glowing citrus-yellow (#FEC107) light streaks and subtle glass reflections sweeping from the lower right, calm and empty on the left 50%. Cinematic, polished. STRICT: no text, no letters, no logos, no people." },
];

let total = 0;
for (const j of jobs) {
  if (only && !only.includes(j.name)) continue;
  const placement = getPlacement(j.placement)!;
  const r = await generateImage("gpt-image", { prompt: j.prompt, tier: "standard", placement, referenceImages: [] });
  total += r.estCostUsd;
  const buf = Buffer.from(r.imageBase64, "base64");
  fs.writeFileSync(`${OUT}/${j.name}.png`, buf);
  await sharp(buf).webp({ quality: 82 }).toFile(`${OUT}/${j.name}.webp`);
  console.log(j.name, r.modelUsed, r.estCostUsd);
}
console.log("total est", total.toFixed(3));
