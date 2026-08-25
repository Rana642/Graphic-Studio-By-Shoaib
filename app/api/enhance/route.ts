import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/supabase/auth";
import { enhanceGeneration, UPSCALE_SCALES } from "@/lib/enhance";

const bodySchema = z.object({
  generationId: z.string().uuid(),
  scale: z.union([z.literal(2), z.literal(4), z.literal(6)]).default(4),
  model: z
    .enum(["Standard V2", "High Fidelity V2", "Text Refine", "CGI", "Low Resolution V2"])
    .default("Standard V2"),
});

/** Upscales an already-generated image via Topaz. See the comment in
 *  /api/generate for why this whole handler is one try/catch. */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const generation = await enhanceGeneration(parsed.data.generationId, {
      scale: parsed.data.scale as (typeof UPSCALE_SCALES)[number],
      model: parsed.data.model,
    });

    return NextResponse.json({ generation });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
