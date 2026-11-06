import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/supabase/auth";
import { previewRecompose } from "@/lib/layered/generate";

const bodySchema = z.object({
  generationId: z.string().uuid(),
  label: z.string().max(60).optional(),
  hook: z.string().min(1).max(200).optional(),
  cta: z.string().max(60).optional(),
});

/** Live preview of a text change on a saved exact-text design: composed, never saved. */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const { imageBase64, report } = await previewRecompose(parsed.data);
    return NextResponse.json({ image: `data:image/png;base64,${imageBase64}`, notes: report.notes, contrastPass: report.contrastPass });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
