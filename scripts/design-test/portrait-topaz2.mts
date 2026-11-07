import fs from "node:fs";
import sharp from "sharp";
import { upscaleWithTopaz } from "../../lib/enhancers/topaz.ts";
const OUT = process.argv[2]!;
for (const name of ["A-light-studio", "B-modern-office", "C-dark-studio"]) {
  const buf = fs.readFileSync(`${OUT}/${name}.png`);
  const up = await upscaleWithTopaz({ imageBuffer: buf, mimeType: "image/png", outputWidth: 2048, outputHeight: 3072 }, "Standard V2");
  fs.writeFileSync(`${OUT}/${name}-std.png`, up.imageBuffer);
  // plain high-quality resize for comparison
  await sharp(buf).resize(2048, 3072, { kernel: "lanczos3" }).sharpen({ sigma: 0.6 }).png().toFile(`${OUT}/${name}-lanczos.png`);
  console.log(name, "ok", up.estCostUsd);
}
// face crops (B) for side-by-side
const faceBox = { left: 560, top: 380, width: 900, height: 900 };
for (const v of ["topaz", "std", "lanczos"]) {
  await sharp(`${OUT}/B-modern-office-${v}.png`).extract(faceBox).resize(500, 500).toFile(`${OUT}/face-${v}.png`);
}
await sharp({ create: { width: 1500, height: 500, channels: 3, background: "#fff" } })
  .composite(["topaz", "std", "lanczos"].map((v, i) => ({ input: `${OUT}/face-${v}.png`, left: i * 500, top: 0 })))
  .png().toFile(`${OUT}/face-compare.png`);
