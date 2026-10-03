import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/supabase/auth";
import { finalizeConcepts } from "@/lib/photoshoot";

const bodySchema = z.object({
  conceptIds: z.array(z.string().uuid()).min(1).max(10),
  tier: z.enum(["standard", "premium"]),
  delivery: z.enum(["instant", "batch"]).optional(),
  provider: z.enum(["nano-banana", "gpt-image"]).optional(),
  qualityCheck: z.boolean().optional(),
});

/** Product Photoshoot step 3 — render approved concepts as finals. */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const results = await finalizeConcepts(parsed.data);
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
