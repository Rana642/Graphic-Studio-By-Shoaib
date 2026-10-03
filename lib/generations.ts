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
  /** "batch" rows sit at status "pending" until their provider job finishes. */
  delivery: "instant" | "batch";
  /** The provider batch job (OpenAI "batch_…" / Gemini "batches/…") — batch rows only. */
  provider_job_id: string | null;
  completed_at: string | null;
  /** Vision quality gate (lib/quality-gate.ts): 0-100, what it found, and how
   *  many images the placement took (2 = retried once with a fix hint). */
  quality_score: number | null;
  quality_notes: string | null;
  quality_attempts: number | null;
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
  delivery?: Generation["delivery"];
  quality_score?: number;
  quality_notes?: string;
  quality_attempts?: number;
}): Promise<Generation> {
  const { data, error } = await db.from("generations").insert(row).select().single();
  if (error && isMissingQualityColumn(error)) {
    // Before the quality SQL has been run: save the image anyway, without its score.
    const rest = Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith("quality_")));
    const retry = await db.from("generations").insert(rest).select().single();
    if (retry.error) throw retry.error;
    return retry.data;
  }
  if (error) throw error;
  return data;
}

/** Saves a quality-gate verdict on an existing generation (e.g. one checked
 *  later through the MCP studio_check_quality tool). No-op before the
 *  quality SQL has been run. */
export async function recordQuality(id: string, q: { score: number; notes: string; attempts?: number }): Promise<void> {
  const { error } = await db
    .from("generations")
    .update({ quality_score: q.score, quality_notes: q.notes, ...(q.attempts ? { quality_attempts: q.attempts } : {}) })
    .eq("id", id);
  if (error && !isMissingQualityColumn(error)) throw error;
}

/** PostgREST's error when a quality_* column doesn't exist yet. */
export function isMissingQualityColumn(error: { message?: string }): boolean {
  return /quality_(score|notes|attempts)/.test(error.message ?? "");
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
