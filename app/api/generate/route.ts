import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/supabase/auth";
import { getBrand } from "@/lib/brands";
import { getPlacement } from "@/lib/placements";
import type { Provider, Tier } from "@/lib/image-providers";
import { generateCopy } from "@/lib/copywriting";
import { loadBrandLogo, loadReferenceImagesAsBase64 } from "@/lib/references";
import { buildImageContract } from "@/lib/prompt";
import { expectedTextOf, GLOBAL_DESIGN_RULE, renderContract } from "@/lib/prompt-contract";
import { runGenerationBatch } from "@/lib/generate-batch";

const bodySchema = z.object({
  brandId: z.string().uuid(),
  offer: z.string().min(1).max(500),
  provider: z.enum(["nano-banana", "gpt-image"]),
  tier: z.enum(["draft", "standard", "premium"]),
  placementIds: z.array(z.string()).min(1).max(6),
  // "batch" = provider Batch API, half price, results within 24 h (see lib/batch-jobs.ts).
  delivery: z.enum(["instant", "batch"]).optional(),
  // Vision quality gate (lib/quality-gate.ts) — on unless explicitly false.
  qualityCheck: z.boolean().optional(),
});

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
    const { brandId, offer, provider, tier, placementIds, delivery, qualityCheck } = parsed.data;

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
    // Image 1 = the brand logo (when it has one), then its saved style
    // references — the prompt contract's IMAGE REFERENCES line names each.
    const [logo, styleRefs] = await Promise.all([loadBrandLogo(brand.logo_url), loadReferenceImagesAsBase64(brandId)]);
    const referenceImages = [...(logo ? [logo] : []), ...styleRefs];
    const contract = buildImageContract(brand, colors, copy, { offer, hasLogo: Boolean(logo), styleRefCount: styleRefs.length });
    const prompt = renderContract(contract);

    const { batchId, results } = await runGenerationBatch({
      brandId,
      prompt,
      provider: provider as Provider,
      tier: tier as Tier,
      placements,
      referenceImages,
      copy,
      delivery,
      contract,
      expectedText: expectedTextOf(contract),
      qualityCheck,
      qualityRules: GLOBAL_DESIGN_RULE,
    });

    return NextResponse.json({ batchId, copy, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
