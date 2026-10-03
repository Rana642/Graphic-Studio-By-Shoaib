import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/supabase/auth";
import { getBrand } from "@/lib/brands";
import { getPlacement } from "@/lib/placements";
import type { Provider, Tier } from "@/lib/image-providers";
import { buildSubjectEditContract } from "@/lib/prompt";
import { renderContract } from "@/lib/prompt-contract";
import { runGenerationBatch } from "@/lib/generate-batch";
import { autoRetouchPhoto } from "@/lib/retouch";

const bodySchema = z.object({
  subjectImage: z.object({ base64: z.string(), mimeType: z.string() }),
  sceneDescription: z.string().min(1).max(1000),
  provider: z.enum(["nano-banana", "gpt-image"]),
  tier: z.enum(["draft", "standard", "premium"]),
  placementIds: z.array(z.string()).min(1).max(6),
  // "batch" = provider Batch API, half price, results within 24 h (see lib/batch-jobs.ts).
  delivery: z.enum(["instant", "batch"]).optional(),
  // Vision quality gate (lib/quality-gate.ts) — on unless explicitly false.
  qualityCheck: z.boolean().optional(),
  brandId: z.string().uuid().optional(),
});

/** Subject-Preserving Edit track — a real person/product photo (subjectImage)
 *  stays visually identical while the AI generates a new scene around it
 *  (buildSubjectEditPrompt carries the preservation instructions). brandId
 *  is optional and only files the result under that brand's history, same
 *  as /api/generate-prompt. See the comment in /api/generate for why this
 *  whole handler is one try/catch. */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { subjectImage, sceneDescription, provider, tier, placementIds, brandId, delivery, qualityCheck } = parsed.data;

    const placements = placementIds.map(getPlacement).filter((p) => p !== undefined);
    if (placements.length === 0) {
      return NextResponse.json({ error: "No valid placements selected." }, { status: 400 });
    }

    if (brandId) {
      const brand = await getBrand(brandId);
      if (!brand) return NextResponse.json({ error: "Brand not found." }, { status: 404 });
    }

    const contract = buildSubjectEditContract(sceneDescription);
    const prompt = renderContract(contract);

    // Basic exposure/contrast correction on the real subject first — same
    // discipline a designer applies in Photoshop before any creative work.
    // Deterministic pixel remapping only, so the face/subject's shape is
    // untouched; buildSubjectEditPrompt is what keeps the AI step from
    // touching it too.
    const retouchedBuffer = await autoRetouchPhoto(Buffer.from(subjectImage.base64, "base64"));
    const retouchedSubjectImage = { base64: retouchedBuffer.toString("base64"), mimeType: "image/png" };

    const { batchId, results } = await runGenerationBatch({
      brandId: brandId ?? null,
      prompt,
      provider: provider as Provider,
      tier: tier as Tier,
      placements,
      referenceImages: [retouchedSubjectImage],
      track: "subject_edit",
      delivery,
      contract,
      expectedText: [],
      qualityCheck,
    });

    return NextResponse.json({ batchId, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
