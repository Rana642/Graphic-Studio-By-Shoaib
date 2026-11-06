import "server-only";
import { generateImage, type Complexity, type Provider, type Tier } from "../image-providers";
import { buildImageContract } from "../prompt";
import { renderContract } from "../prompt-contract";
import { getBrand, type Brand } from "../brands";
import { loadReferenceImagesAsBase64 } from "../references";
import { getGeneration, insertGeneration, uploadGeneratedImage, type Generation } from "../generations";
import { db } from "../supabase/db";
import type { Placement } from "../placements";
import { composeLayered, type BrandStyle, type ComposeContent } from "./compose";
import { PRESETS, type Preset } from "./layouts";

/**
 * Exact-text designs, end to end: the AI draws a text-free background (the
 * only paid step), then composeLayered puts the words, badge, CTA and logo on
 * top. The background and the layout recipe are saved on the row, so a text
 * change later (recomposeLayered) is free and instant.
 */

const SQL_HINT = 'Run the "Exact text" SQL at the end of supabase-schema.sql (track "layered" + background_url + layout_json) in the Supabase SQL Editor first.';

const EMPTY_AREA =
  "TEXT-FREE BACKGROUND: draw NO words, letters, numbers, logos, badges, buttons or watermarks anywhere in the image. Keep a calm, light, low-detail area (soft out-of-focus or plain colour) across the left 55% of the frame and along the lower third, where text will be added later. Put the hero visual in the upper right.";

type Copy = { label: string; hook: string; cta: string };

const styleOf = (brand: Brand): BrandStyle => ({ name: brand.name, primary_hex: brand.primary_hex, accent_hex: brand.accent_hex, font_family: brand.font_family });

async function fetchBytes(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** The background brief: the brand's normal contract, minus every word, the logo and the contact line. */
export function backgroundPrompt(brand: Brand, colors: string[], copy: Copy, offer: string, styleRefCount: number): string {
  const contract = buildImageContract(brand, colors, copy, { offer, hasLogo: false, styleRefCount });
  return renderContract({
    ...contract,
    frame: `Text-free background image for a social media marketing graphic for the brand "${brand.name}" — poster-grade, filling the whole frame.`,
    text: "none",
    logo: undefined,
    keyElements: "One hero visual that shows the campaign idea at a glance. No badge, no button, no lettering of any kind.",
    composition: EMPTY_AREA,
  });
}

function rethrowWithHint(error: unknown): never {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  if (/layered|background_url|layout_json/.test(message)) throw new Error(`${message}\n${SQL_HINT}`);
  throw error instanceof Error ? error : new Error(message);
}

export async function runExactTextGeneration(input: {
  brandId: string;
  offer: string;
  copy: Copy;
  provider: Provider;
  tier: Tier;
  placements: Placement[];
  complexity?: Complexity;
  preset?: Preset | "auto";
}): Promise<{ batchId: string; results: Generation[] }> {
  const brand = await getBrand(input.brandId);
  if (!brand) throw new Error("Brand not found.");
  const colors = [brand.primary_hex, brand.secondary_hex, brand.accent_hex].filter((c): c is string => Boolean(c));
  const [styleRefs, logo] = await Promise.all([loadReferenceImagesAsBase64(input.brandId), fetchBytes(brand.logo_url)]);
  const prompt = backgroundPrompt(brand, colors, input.copy, input.offer, styleRefs.length);
  const batchId = crypto.randomUUID();

  const results = await Promise.all(
    input.placements.map(async (placement): Promise<Generation> => {
      try {
        const bg = await generateImage(input.provider, {
          prompt,
          tier: input.tier,
          placement,
          referenceImages: styleRefs,
          complexity: input.provider === "gpt-image" ? input.complexity : undefined,
        });
        const composed = await composeLayered({
          background: Buffer.from(bg.imageBase64, "base64"),
          width: placement.width,
          height: placement.height,
          content: input.copy,
          brand: styleOf(brand),
          logo,
          preset: input.preset ?? "auto",
        });
        const [backgroundUrl, imageUrl] = await Promise.all([
          uploadGeneratedImage(input.brandId, `${placement.id}-bg`, bg.imageBase64, bg.mimeType),
          uploadGeneratedImage(input.brandId, placement.id, composed.png.toString("base64"), "image/png"),
        ]);
        return await insertGeneration({
          brand_id: input.brandId,
          batch_id: batchId,
          track: "layered",
          placement: placement.id,
          model_used: bg.modelUsed,
          prompt_used: prompt,
          copy_label: input.copy.label,
          copy_hook: input.copy.hook,
          copy_cta: input.copy.cta,
          image_url: imageUrl,
          est_cost_usd: bg.estCostUsd,
          status: "complete",
          background_url: backgroundUrl,
          layout_json: composed.layoutJson,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        // A missing enum value / column is a setup problem, not a generation failure: say how to fix it.
        if (/layered|background_url|layout_json/.test(message)) rethrowWithHint(err);
        return insertGeneration({
          brand_id: input.brandId,
          batch_id: batchId,
          track: "layered",
          placement: placement.id,
          prompt_used: prompt,
          status: "failed",
          error_message: message,
        });
      }
    })
  );
  return { batchId, results };
}

type SavedLayout = {
  canvas?: { width?: number; height?: number };
  preset?: string;
  brand?: { name?: string; primary?: string; accent?: string; font_family?: string | null };
  content?: ComposeContent;
};

/**
 * Changes the words on a saved exact-text design: same background, same
 * layout, new text. Free (no AI call). The enhanced (upscaled) copy, if any,
 * is cleared because it no longer matches.
 */
export async function recomposeLayered(input: { generationId: string; label?: string; hook?: string; cta?: string }): Promise<Generation> {
  const row = await getGeneration(input.generationId);
  if (!row || row.track !== "layered" || !row.background_url || !row.layout_json) throw new Error("That image is not an exact-text design, so its text can't be edited.");
  const saved = row.layout_json as SavedLayout;
  const width = saved.canvas?.width;
  const height = saved.canvas?.height;
  if (!width || !height) throw new Error("This design's saved layout is incomplete.");

  const content: ComposeContent = {
    label: input.label !== undefined ? input.label : saved.content?.label,
    hook: input.hook ?? saved.content?.hook ?? "",
    cta: input.cta !== undefined ? input.cta : saved.content?.cta,
  };
  if (!content.hook.trim()) throw new Error("The headline can't be empty.");

  const [background, brand] = await Promise.all([fetchBytes(row.background_url), row.brand_id ? getBrand(row.brand_id) : Promise.resolve(null)]);
  if (!background) throw new Error("The saved background could not be downloaded.");
  const logo = await fetchBytes(brand?.logo_url);
  const style: BrandStyle = brand
    ? styleOf(brand)
    : { name: saved.brand?.name ?? "", primary_hex: saved.brand?.primary ?? "#0f0f14", accent_hex: saved.brand?.accent ?? null, font_family: saved.brand?.font_family ?? null };

  const preset = (PRESETS as readonly string[]).includes(saved.preset ?? "") ? (saved.preset as Preset) : "auto";
  const composed = await composeLayered({ background, width, height, content, brand: style, logo, preset });
  const imageUrl = await uploadGeneratedImage(row.brand_id, `${row.placement}-edit`, composed.png.toString("base64"), "image/png");

  const { data, error } = await db
    .from("generations")
    .update({
      image_url: imageUrl,
      layout_json: composed.layoutJson,
      copy_label: content.label ?? null,
      copy_hook: content.hook,
      copy_cta: content.cta ?? null,
      upscaled_image_url: null,
    })
    .eq("id", row.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Generation;
}
