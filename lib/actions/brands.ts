"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createBrand, updateBrand, deleteBrand } from "../brands";
import { getUser } from "../supabase/auth";

const hex = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex code, e.g. #1E40AF")
  .optional()
  .or(z.literal(""));

const brandSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  logo_url: z.string().url().optional().or(z.literal("")),
  primary_hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex code, e.g. #111111"),
  secondary_hex: hex,
  accent_hex: hex,
  font_family: z.string().max(100).optional().or(z.literal("")),
  voice_notes: z.string().max(2000).optional().or(z.literal("")),
});

/** Server actions are public endpoints — proxy.ts guards pages, not this. */
async function assertAuthed() {
  const user = await getUser();
  if (!user) redirect("/login");
}

function parseForm(formData: FormData) {
  return brandSchema.safeParse({
    name: formData.get("name"),
    logo_url: formData.get("logo_url") || "",
    primary_hex: formData.get("primary_hex"),
    secondary_hex: formData.get("secondary_hex") || "",
    accent_hex: formData.get("accent_hex") || "",
    font_family: formData.get("font_family") || "",
    voice_notes: formData.get("voice_notes") || "",
  });
}

function toInput(parsed: z.infer<typeof brandSchema>) {
  return {
    name: parsed.name,
    logo_url: parsed.logo_url || null,
    primary_hex: parsed.primary_hex,
    secondary_hex: parsed.secondary_hex || null,
    accent_hex: parsed.accent_hex || null,
    font_family: parsed.font_family || null,
    voice_notes: parsed.voice_notes || null,
  };
}

export async function createBrandAction(formData: FormData) {
  await assertAuthed();
  const parsed = parseForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await createBrand(toInput(parsed.data));
  revalidatePath("/brands");
  redirect("/brands");
}

export async function updateBrandAction(id: string, formData: FormData) {
  await assertAuthed();
  const parsed = parseForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await updateBrand(id, toInput(parsed.data));
  revalidatePath("/brands");
  revalidatePath(`/brands/${id}`);
  redirect("/brands");
}

export async function deleteBrandAction(id: string) {
  await assertAuthed();
  await deleteBrand(id);
  revalidatePath("/brands");
  redirect("/brands");
}
