import "server-only";
import { db } from "./supabase/db";

export type BrandReference = {
  id: string;
  brand_id: string;
  image_url: string;
  note: string | null;
  created_at: string;
};

export async function listReferencesForBrand(brandId: string): Promise<BrandReference[]> {
  const { data, error } = await db
    .from("brand_references")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function uploadReference(
  brandId: string,
  file: File,
  note: string | null
): Promise<BrandReference> {
  const ext = file.name.split(".").pop() || "png";
  const path = `${brandId}/references/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await db.storage
    .from("logos")
    .upload(path, buffer, { contentType: file.type || "image/png", upsert: false });
  if (uploadError) throw uploadError;

  const { data: urlData } = db.storage.from("logos").getPublicUrl(path);

  const { data, error } = await db
    .from("brand_references")
    .insert({ brand_id: brandId, image_url: urlData.publicUrl, note })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteReference(id: string, imageUrl: string): Promise<void> {
  // Storage path is everything after the bucket name in the public URL.
  const marker = "/object/public/logos/";
  const idx = imageUrl.indexOf(marker);
  if (idx !== -1) {
    const path = imageUrl.slice(idx + marker.length);
    await db.storage.from("logos").remove([path]);
  }
  const { error } = await db.from("brand_references").delete().eq("id", id);
  if (error) throw error;
}

/** The brand's own logo as an attachable image (image 1 in the prompt
 *  contract). SVG/WebP logos are rasterised to PNG — the image APIs only
 *  take bitmaps. Null when the brand has no logo or it can't be fetched. */
export async function loadBrandLogo(logoUrl: string | null): Promise<{ base64: string; mimeType: string } | null> {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get("content-type") || "";
    if (/png|jpe?g/.test(type)) return { base64: buffer.toString("base64"), mimeType: type.split(";")[0] };
    const { default: sharp } = await import("sharp");
    const png = await sharp(buffer, { density: 300 }).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: false }).png().toBuffer();
    return { base64: png.toString("base64"), mimeType: "image/png" };
  } catch {
    return null;
  }
}

/** Fetches each reference image and base64-encodes it, for providers (Nano
 *  Banana) that accept inline reference images alongside the text prompt. */
export async function loadReferenceImagesAsBase64(
  brandId: string
): Promise<{ base64: string; mimeType: string }[]> {
  const refs = await listReferencesForBrand(brandId);
  const loaded = await Promise.all(
    refs.map(async (ref) => {
      try {
        const res = await fetch(ref.image_url);
        if (!res.ok) return null;
        const mimeType = res.headers.get("content-type") || "image/png";
        const buffer = Buffer.from(await res.arrayBuffer());
        return { base64: buffer.toString("base64"), mimeType };
      } catch {
        return null;
      }
    })
  );
  return loaded.filter((r): r is { base64: string; mimeType: string } => r !== null);
}
