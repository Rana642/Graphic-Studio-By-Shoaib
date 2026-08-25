"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { uploadReference, deleteReference } from "../references";
import { getUser } from "../supabase/auth";

async function assertAuthed() {
  const user = await getUser();
  if (!user) redirect("/login");
}

export async function uploadReferenceAction(brandId: string, formData: FormData) {
  await assertAuthed();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image file." };
  }
  if (!file.type.startsWith("image/")) {
    return { error: "Only image files are supported." };
  }
  const note = (formData.get("note") as string) || null;

  try {
    await uploadReference(brandId, file, note);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    return { error: message };
  }

  revalidatePath(`/brands/${brandId}`);
}

export async function deleteReferenceAction(id: string, imageUrl: string, brandId: string) {
  await assertAuthed();
  await deleteReference(id, imageUrl);
  revalidatePath(`/brands/${brandId}`);
}
