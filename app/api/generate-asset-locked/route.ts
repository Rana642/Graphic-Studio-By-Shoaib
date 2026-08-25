import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/supabase/auth";
import { getBrand } from "@/lib/brands";
import { generateAssetLocked } from "@/lib/asset-locked/generate";

const bodySchema = z.object({
  templateId: z.string(),
  fieldValues: z.record(z.string(), z.string()),
  photo: z.object({ base64: z.string(), mimeType: z.string() }),
  brandId: z.string().uuid().optional(),
});

/** Asset-Locked Track — the real photo/render is composited deterministically
 *  (sharp + resvg-js, see lib/asset-locked/), never touched by AI. No
 *  provider/tier: this path makes no AI call at all. See the comment in
 *  /api/generate for why this whole handler is one try/catch. */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { templateId, fieldValues, photo, brandId } = parsed.data;

    if (brandId) {
      const brand = await getBrand(brandId);
      if (!brand) return NextResponse.json({ error: "Brand not found." }, { status: 404 });
    }

    const generation = await generateAssetLocked({
      templateId,
      brandId: brandId ?? null,
      fieldValues,
      photoBuffer: Buffer.from(photo.base64, "base64"),
    });

    return NextResponse.json({ generation });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
