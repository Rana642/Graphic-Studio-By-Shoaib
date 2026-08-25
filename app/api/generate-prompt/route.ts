import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/supabase/auth";
import { getBrand } from "@/lib/brands";
import { getPlacement } from "@/lib/placements";
import type { Provider, Tier } from "@/lib/image-providers";
import { loadReferenceImagesAsBase64 } from "@/lib/references";
import { runGenerationBatch } from "@/lib/generate-batch";

const bodySchema = z.object({
  prompt: z.string().min(1).max(2000),
  provider: z.enum(["nano-banana", "gpt-image"]),
  tier: z.enum(["draft", "standard", "premium"]),
  placementIds: z.array(z.string()).min(1).max(6),
  brandId: z.string().uuid().optional(),
  // Ad-hoc, one-off reference images attached directly in the form — not
  // saved anywhere, unlike a brand's persistent brand_references. Capped at
  // 4: these ride along as base64 in the JSON body, and each provider's API
  // call already carries the full prompt + every image inline.
  referenceImages: z
    .array(z.object({ base64: z.string(), mimeType: z.string() }))
    .max(4)
    .optional(),
});

/** Free-prompt generation — no brand required. If brandId is given, it's
 *  used only to pull that brand's reference images (style consistency) and
 *  to file the resulting rows under that brand's history; the brand's
 *  colors/voice are never mixed into the prompt, unlike /api/generate.
 *  See the comment in that route for why this whole handler is one
 *  try/catch. */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { prompt, provider, tier, placementIds, brandId, referenceImages: adHocReferenceImages } =
      parsed.data;

    const placements = placementIds.map(getPlacement).filter((p) => p !== undefined);
    if (placements.length === 0) {
      return NextResponse.json({ error: "No valid placements selected." }, { status: 400 });
    }

    let brandReferenceImages: { base64: string; mimeType: string }[] = [];
    if (brandId) {
      const brand = await getBrand(brandId);
      if (!brand) return NextResponse.json({ error: "Brand not found." }, { status: 404 });
      brandReferenceImages = await loadReferenceImagesAsBase64(brandId);
    }
    const referenceImages = [...(adHocReferenceImages ?? []), ...brandReferenceImages];

    const { batchId, results } = await runGenerationBatch({
      brandId: brandId ?? null,
      prompt,
      provider: provider as Provider,
      tier: tier as Tier,
      placements,
      referenceImages,
    });

    return NextResponse.json({ batchId, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
