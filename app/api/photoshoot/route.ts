import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/supabase/auth";
import { runPhotoshoot } from "@/lib/photoshoot";
import { PHOTOSHOOT_MODES } from "@/lib/photoshoot-modes";

const image = z.object({ base64: z.string().min(1), mimeType: z.string() });

const bodySchema = z.object({
  mode: z.enum(PHOTOSHOOT_MODES.map((m) => m.id) as [string, ...string[]]),
  images: z.array(image).min(1).max(3),
  brandId: z.string().uuid().optional(),
  answers: z.record(z.string(), z.string()).optional(),
  note: z.string().max(500).optional(),
  text: z.object({ headline: z.string().max(120).optional(), cta: z.string().max(40).optional() }).optional(),
  count: z.number().int().min(1).max(7).optional(),
  provider: z.enum(["nano-banana", "gpt-image"]),
  qualityCheck: z.boolean().optional(),
});

/** Product Photoshoot step 1 — Draft concepts (see lib/photoshoot.ts). One
 *  try/catch for the whole handler, as in /api/generate. */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const result = await runPhotoshoot({ ...parsed.data, mode: parsed.data.mode as never });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
