import { NextResponse } from "next/server";
import { z } from "zod";
import { COMPLEXITIES } from "@/lib/image-providers/types";
import { getUser } from "@/lib/supabase/auth";
import { getBrand } from "@/lib/brands";
import { runMarkupEdit } from "@/lib/markup-edit";

const bodySchema = z.object({
  image: z.object({ base64: z.string().min(1), mimeType: z.string() }),
  // Transparent PNG, drawn in the browser over the image.
  markupBase64: z.string().min(1),
  prompt: z.string().min(1).max(2000),
  tier: z.enum(["draft", "standard", "premium"]),
  // GPT Image 2.6 only; "low" keeps an edit closest to the source.
  complexity: z.enum(COMPLEXITIES).optional(),
  brandId: z.string().uuid().optional(),
  // Vision quality gate (lib/quality-gate.ts) — on unless explicitly false.
  qualityCheck: z.boolean().optional(),
});

/** Markup-guided edit: GPT Image 2.6 changes only the marked places. Instant
 *  delivery only (2.6 has no Batch API). See /api/generate for why the whole
 *  handler is one try/catch. */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { image, markupBase64, prompt, tier, complexity, brandId, qualityCheck } = parsed.data;

    if (brandId) {
      const brand = await getBrand(brandId);
      if (!brand) return NextResponse.json({ error: "Brand not found." }, { status: 404 });
    }

    const result = await runMarkupEdit({ brandId: brandId ?? null, prompt, tier, complexity, image, markupBase64, qualityCheck });
    return NextResponse.json({ results: [result] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
