import "server-only";
import { db } from "./supabase/db";

export type BrandCostSummary = {
  brandId: string;
  brandName: string;
  generationCount: number;
  completeCount: number;
  failedCount: number;
  /** Batch images still in the provider queue — not billed yet. */
  pendingCount: number;
  totalCostUsd: number;
  /** Batch bills 50% of the normal price, so the saving equals what was paid. */
  batchSavedUsd: number;
};

export type CostedGeneration = {
  id: string;
  placement: string;
  model_used: string | null;
  est_cost_usd: number | null;
  status: "pending" | "complete" | "failed";
  created_at: string;
};

/** Only successful generations carry a real cost — a failed call still
 *  consumed the request in most billing models, but we only have solid
 *  cost data for the ones that actually returned an image, so failed rows
 *  are counted separately rather than guessed at. */
export async function getCostSummaryByBrand(): Promise<BrandCostSummary[]> {
  const { data: brands, error: brandsError } = await db
    .from("brands")
    .select("id, name")
    .order("name");
  if (brandsError) throw brandsError;

  const { data: generations, error: genError } = await db
    .from("generations")
    // "*" rather than naming delivery, so this page still loads before the
    // batch SQL migration has been run.
    .select("*");
  if (genError) throw genError;

  return (brands ?? []).map((brand) => {
    const rows = (generations ?? []).filter((g) => g.brand_id === brand.id);
    const complete = rows.filter((g) => g.status === "complete");
    return {
      brandId: brand.id,
      brandName: brand.name,
      generationCount: rows.length,
      completeCount: complete.length,
      failedCount: rows.filter((g) => g.status === "failed").length,
      pendingCount: rows.filter((g) => g.status === "pending").length,
      totalCostUsd: complete.reduce((sum, g) => sum + (g.est_cost_usd || 0), 0),
      batchSavedUsd: complete.filter((g) => g.delivery === "batch").reduce((sum, g) => sum + (g.est_cost_usd || 0), 0),
    };
  });
}

export async function getCostedGenerationsForBrand(brandId: string): Promise<CostedGeneration[]> {
  const { data, error } = await db
    .from("generations")
    .select("id, placement, model_used, est_cost_usd, status, created_at")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
