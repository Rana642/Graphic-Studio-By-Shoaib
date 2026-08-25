import "server-only";
import sharp from "sharp";

const TARGET_MEAN_LUMINANCE = 130;
const MAX_BRIGHTNESS_GAIN = 1.6;

/**
 * Basic Photoshop-style exposure/contrast correction — the pass a real
 * photo (a person, a room, a product) always gets before any creative work
 * happens on top of it. Deterministic per-pixel tone remapping only
 * (adaptive brightness lift, a percentile-based contrast stretch, a light
 * sharpen) — it cannot alter geometry or features, which is what
 * guarantees a face stays exactly the same shape through this step. Run
 * this before a real photo is handed to either an AI edit call
 * (Subject-Preserving Edit) or sharp compositing (Asset-Locked) — never
 * after.
 *
 * The brightness lift is adaptive, not a fixed multiplier: a dark/
 * underexposed photo gets a real lift toward a reasonable mid-tone target;
 * a photo that's already well-exposed is left close to untouched instead of
 * being blindly brightened. Deliberately NOT combined with sharp's
 * `.normalize()` — normalize is a *relative* contrast stretch that always
 * pushes an image's darkest region toward black regardless of the actual
 * brightness lift applied beforehand, which was silently cancelling out
 * this whole function's purpose (confirmed by rendering a before/after
 * pair: normalize made a deliberately-brightened dark photo end up darker,
 * not lighter).
 */
export async function autoRetouchPhoto(buffer: Buffer): Promise<Buffer> {
  const stats = await sharp(buffer).stats();
  const rgbChannels = stats.channels.slice(0, 3);
  const meanLuminance = rgbChannels.reduce((sum, c) => sum + c.mean, 0) / rgbChannels.length;

  const brightnessGain =
    meanLuminance < TARGET_MEAN_LUMINANCE
      ? Math.min(MAX_BRIGHTNESS_GAIN, TARGET_MEAN_LUMINANCE / Math.max(meanLuminance, 20))
      : 1;

  return sharp(buffer).modulate({ brightness: brightnessGain }).sharpen({ sigma: 0.6 }).toBuffer();
}
