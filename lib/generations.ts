import "server-only";
import { db } from "./supabase/db";
import type { Tier, Provider } from "./image-providers";

export type Generation = {
  id: string;
  brand_id: string;
  batch_id: string;
  track: "creative" | "asset_locked";
  placement: string;
  model_used: string | null;
  prompt_used: string | null;
  copy_label: string | null;
  copy_hook: string | null;
  copy_cta: string | null;
  image_url: string | null;
  est_cost_usd: number | null;
  status: "pending" | "complete" | "failed";
  error_message: string | null;
  created_at: string;
};

export async function listGenerationsForBrand(brandId: string): Promise<Generation[]> {
  const { data, error } = await db
    .from("generations")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function insertGeneration(row: {
  brand_id: string;
  batch_id: string;
  placement: string;
  model_used?: string;
  prompt_used?: string;
  copy_label?: string;
  copy_hook?: string;
  copy_cta?: string;
  image_url?: string;
  est_cost_usd?: number;
  status: "complete" | "failed";
  error_message?: string;
}): Promise<Generation> {
  const { data, error } = await db.from("generations").insert(row).select().single();
  if (error) throw error;
  return data;
}

/** Uploads a base64 image to the `generations` Storage bucket and returns
 *  its public URL. */
export async function uploadGeneratedImage(
  brandId: string,
  placementId: string,
  base64: string,
  mimeType: string
): Promise<string> {
  const ext = mimeType.split("/")[1] || "png";
  const path = `${brandId}/${Date.now()}-${placementId}.${ext}`;
  const buffer = Buffer.from(base64, "base64");

  const { error } = await db.storage
    .from("generations")
    .upload(path, buffer, { contentType: mimeType, upsert: false });
  if (error) throw error;

  const { data } = db.storage.from("generations").getPublicUrl(path);
  return data.publicUrl;
}

export type { Tier, Provider };
