import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/supabase/auth";
import { recomposeLayered } from "@/lib/layered/generate";

const bodySchema = z.object({
  generationId: z.string().uuid(),
  label: z.string().max(60).optional(),
  hook: z.string().min(1).max(200).optional(),
  cta: z.string().max(60).optional(),
});

/** Changes the words on a saved exact-text design (free: the saved background is reused). */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const row = await recomposeLayered(parsed.data);
    return NextResponse.json({ result: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
