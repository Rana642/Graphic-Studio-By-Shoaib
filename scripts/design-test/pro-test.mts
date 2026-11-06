import fs from "node:fs";
import { generateImage } from "../../lib/image-providers/index.ts";
import { composePro } from "../../lib/layered/pro.ts";
import { getPlacement } from "../../lib/placements.ts";

const OUT = process.argv[2]!;
const placement = getPlacement("square");
if (!placement) throw new Error("no square placement");
const bgPath = `${OUT}/bg.png`;
let bg: Buffer;
if (fs.existsSync(bgPath)) bg = fs.readFileSync(bgPath);
else {
  const r = await generateImage("gpt-image", {
    prompt:
      "Text-free background photo for a social media ad, square. A confident South Asian businessman in his 30s, smiling, holding a tablet, shoulder-up, placed on the RIGHT 45% of the frame, large. Soft warm yellow and white studio background, calm and empty on the left 55%. No text, no letters, no logos, no signs, no watermarks anywhere.",
    tier: "draft",
    placement,
    referenceImages: [],
  });
  bg = Buffer.from(r.imageBase64, "base64");
  fs.writeFileSync(bgPath, bg);
  console.log("background cost", r.estCostUsd);
}
const logo = fs.readFileSync(`${OUT}/logo.svg`);
const out = await composePro({
  background: bg,
  width: placement.width,
  height: placement.height,
  brand: { name: "Ads by Shoaib", primary_hex: "#0F0F14", accent_hex: "#FEC107", font_family: null },
  logo,
  contact: { phone: "+92 301 7461642", website: "adsbyshoaib.com" },
  content: {
    kicker: "Performance marketing",
    headline: "More enquiries",
    highlight: "From Google Ads",
    points: [
      { bold: "Free account audit", light: "for new clients" },
      { bold: "Clear monthly report", light: "in plain English" },
      { bold: "One independent expert", light: "runs your ads" },
      { bold: "No long contracts", light: "cancel any time" },
    ],
  },
});
fs.writeFileSync(`${OUT}/pro-offer.png`, out.png);
console.log(placement.id, placement.width, placement.height, out.notes);
