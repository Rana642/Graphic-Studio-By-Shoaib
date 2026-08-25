import "server-only";
import { db } from "./supabase/db";
import type { Tier, Provider } from "./image-providers";

export type Generation = {
  id: string;
  brand_id: string | null;
  batch_id: string;
  track: "creative" | "asset_locked" | "subject_edit";
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
  upscaled_image_url: string | null;
  upscale_provider: string | null;
  upscale_cost_usd: number | null;
  upscaled_at: string | null;
  template_id: string | null;
  created_at: string;
};

export type GenerationFilters = {
  /** Omit to list across every brand + unbranded rows. Pass null explicitly
   *  to list only unbranded (free-prompt) generations. */
  brandId?: string | null;
  batchId?: string;
  status?: Generation["status"];
  limit?: number;
};

export async function listGenerations(filters: GenerationFilters = {}): Promise<Generation[]> {
  let query = db.from("generations").select("*").order("created_at", { ascending: false });
  if (filters.brandId !== undefined) {
    query = filters.brandId === null ? query.is("brand_id", null) : query.eq("brand_id", filters.brandId);
  }
  if (filters.batchId) query = query.eq("batch_id", filters.batchId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.limit) query = query.limit(filters.limit);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export function listGenerationsForBrand(brandId: string): Promise<Generation[]> {
  return listGenerations({ brandId });
}

export async function getGeneration(id: string): Promise<Generation | null> {
  const { data, error } = await db.from("generations").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

/** Records the result of running an existing generation through an
 *  upscaler (see lib/enhancers/). One enhancement slot per row —
 *  re-enhancing the same generation overwrites the previous result. */
export async function recordUpscale(
  id: string,
  input: { upscaledImageUrl: string; provider: string; costUsd: number }
): Promise<Generation> {
  const { data, error } = await db
    .from("generations")
    .update({
      upscaled_image_url: input.upscaledImageUrl,
      upscale_provider: input.provider,
      upscale_cost_usd: input.costUsd,
      upscaled_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function insertGeneration(row: {
  brand_id: string | null;
  batch_id: string;
  track?: Generation["track"];
  placement: string;
  model_used?: string;
  prompt_used?: string;
  copy_label?: string;
  copy_hook?: string;
  copy_cta?: string;
  image_url?: string;
  est_cost_usd?: number;
  template_id?: string;
  status: "complete" | "failed";
  error_message?: string;
}): Promise<Generation> {
  const { data, error } = await db.from("generations").insert(row).select().single();
  if (error) throw error;
  return data;
}

/** Uploads a base64 image to the `generations` Storage bucket and returns
 *  its public URL. `brandId` is null for free-prompt generations not tied
 *  to any brand — those land under an "unbranded" storage prefix. */
export async function uploadGeneratedImage(
  brandId: string | null,
  placementId: string,
  base64: string,
  mimeType: string
): Promise<string> {
  const ext = mimeType.split("/")[1] || "png";
  const path = `${brandId ?? "unbranded"}/${Date.now()}-${placementId}.${ext}`;
  const buffer = Buffer.from(base64, "base64");

  const { error } = await db.storage
    .from("generations")
    .upload(path, buffer, { contentType: mimeType, upsert: false });
  if (error) throw error;

  const { data } = db.storage.from("generations").getPublicUrl(path);
  return data.publicUrl;
}

export type { Tier, Provider };
