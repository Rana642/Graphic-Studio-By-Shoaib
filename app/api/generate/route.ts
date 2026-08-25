import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/supabase/auth";
import { getBrand } from "@/lib/brands";
import { getPlacement } from "@/lib/placements";
import { generateImage, type Provider, type Tier } from "@/lib/image-providers";
import { generateCopy } from "@/lib/copywriting";
import { insertGeneration, uploadGeneratedImage } from "@/lib/generations";
import { loadReferenceImagesAsBase64 } from "@/lib/references";

const bodySchema = z.object({
  brandId: z.string().uuid(),
  offer: z.string().min(1).max(500),
  provider: z.enum(["nano-banana", "gpt-image"]),
  tier: z.enum(["draft", "standard", "premium"]),
  placementIds: z.array(z.string()).min(1).max(6),
});

function buildImagePrompt(
  brandName: string,
  colors: string[],
  voice: string | null,
  copy: { label: string; hook: string; cta: string }
) {
  return [
    `Professional marketing graphic for the brand "${brandName}".`,
    `Strict color palette: ${colors.filter(Boolean).join(", ")}.`,
    voice ? `Visual style/vibe: ${voice}.` : "",
    `Print the small badge label "${copy.label.toUpperCase()}" near the top.`,
    `Render the bold primary headline "${copy.hook}" with strong visual contrast, centered.`,
    `Place the call-to-action "${copy.cta.toUpperCase()}" inside a solid button-style shape near the bottom.`,
    "Clean, premium layout. Do not add random decorative shapes, extra text, or misspelled words.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The whole handler runs inside one try/catch — an uncaught throw here
 * (e.g. request.json() on a malformed body) previously fell through to
 * Next's default error page, which isn't valid JSON. The client's
 * res.json() call would then throw, landing in its own catch block and
 * misreporting a real server error as "Network error — check the dev
 * server is running." Caught during Phase 2 testing (2026-08-24/25) via a
 * deprecated Gemini model name — keep this wrapper so the next unexpected
 * failure shows its real message instead of that red herring.
 */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { brandId, offer, provider, tier, placementIds } = parsed.data;

    const brand = await getBrand(brandId);
    if (!brand) return NextResponse.json({ error: "Brand not found." }, { status: 404 });

    const placements = placementIds.map(getPlacement).filter((p) => p !== undefined);
    if (placements.length === 0) {
      return NextResponse.json({ error: "No valid placements selected." }, { status: 400 });
    }

    let copy;
    try {
      copy = await generateCopy(provider as Provider, brand, offer);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: `Copywriting failed: ${message}` }, { status: 502 });
    }

    const colors = [brand.primary_hex, brand.secondary_hex, brand.accent_hex].filter(
      (c): c is string => Boolean(c)
    );
    const prompt = buildImagePrompt(brand.name, colors, brand.voice_notes, copy);
    const batchId = crypto.randomUUID();

    // Only Nano Banana can use these (see gptImage.ts) — skip the fetch/
    // base64 work entirely for the other provider.
    const referenceImages =
      provider === "nano-banana" ? await loadReferenceImagesAsBase64(brandId) : [];

    const results = await Promise.all(
      placements.map(async (placement) => {
        try {
          const image = await generateImage(provider as Provider, {
            prompt,
            tier: tier as Tier,
            placement,
            referenceImages,
          });
          const imageUrl = await uploadGeneratedImage(
            brandId,
            placement.id,
            image.imageBase64,
            image.mimeType
          );
          return await insertGeneration({
            brand_id: brandId,
            batch_id: batchId,
            placement: placement.id,
            model_used: image.modelUsed,
            prompt_used: prompt,
            copy_label: copy.label,
            copy_hook: copy.hook,
            copy_cta: copy.cta,
            image_url: imageUrl,
            est_cost_usd: image.estCostUsd,
            status: "complete",
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          return insertGeneration({
            brand_id: brandId,
            batch_id: batchId,
            placement: placement.id,
            prompt_used: prompt,
            status: "failed",
            error_message: message,
          });
        }
      })
    );

    return NextResponse.json({ batchId, copy, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
