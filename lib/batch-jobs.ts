import "server-only";
import { db } from "./supabase/db";
import { pollImageBatch, submitImageBatch } from "./image-providers";
import { isMissingQualityColumn, uploadGeneratedImage, type Generation } from "./generations";
import { expectedTextFromPrompt, GLOBAL_DESIGN_RULE } from "./prompt-contract";
import { judgeImage, qualityNote } from "./quality-gate";
import type { GenerationBatchInput } from "./generate-batch";

/**
 * Batch delivery (2026-10-02): the same generations as the instant path, sent
 * through OpenAI's / Google's Batch API at half the price. Rows are written
 * up front as status "pending" (delivery "batch", provider_job_id set), and
 * syncBatchJobs() later turns them into "complete"/"failed" once the
 * provider's job is done. The app runs locally (no public URL for a
 * webhook), so syncing happens whenever the Batches page or the MCP
 * studio_check_batches tool asks.
 */

/** A provider job that is still not done this long after submission is
 *  given up on (both providers promise 24 h). */
const GIVE_UP_AFTER_MS = 26 * 60 * 60 * 1000;
/** Rows whose submission never got a provider job id (crash mid-submit). */
const ORPHAN_AFTER_MS = 15 * 60 * 1000;

export async function submitBatchGeneration(
  input: GenerationBatchInput
): Promise<{ batchId: string; results: Generation[] }> {
  const batchId = crypto.randomUUID();

  const { data: rows, error } = await db
    .from("generations")
    .insert(
      input.placements.map((placement) => ({
        brand_id: input.brandId,
        batch_id: batchId,
        track: input.track,
        placement: placement.id,
        prompt_used: input.prompt,
        copy_label: input.copy?.label,
        copy_hook: input.copy?.hook,
        copy_cta: input.copy?.cta,
        status: "pending",
        delivery: "batch",
      })),
      // A multi-row insert otherwise sends omitted fields (track) as NULL
      // instead of letting the column default apply.
      { defaultToNull: false }
    )
    .select();
  if (error) throw migrationHint(error);
  const pending = rows as Generation[];
  const ids = pending.map((r) => r.id);

  try {
    const job = await submitImageBatch(input.provider, {
      tier: input.tier,
      referenceImages: input.referenceImages,
      items: pending.map((r) => ({
        key: r.id,
        prompt: input.prompt,
        placement: input.placements.find((p) => p.id === r.placement)!,
      })),
      label: `Graphic Studio ${batchId}`,
    });
    const { data: updated, error: updateError } = await db
      .from("generations")
      .update({ provider_job_id: job.jobId, model_used: job.modelUsed, est_cost_usd: job.estCostUsd })
      .in("id", ids)
      .select();
    if (updateError) throw updateError;
    return { batchId, results: sortLike(ids, updated as Generation[]) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const { data: failed } = await db
      .from("generations")
      .update({ status: "failed", error_message: `Batch submit failed: ${message}`, completed_at: new Date().toISOString() })
      .in("id", ids)
      .select();
    return { batchId, results: sortLike(ids, (failed ?? pending) as Generation[]) };
  }
}

/** Before the batch SQL has been run, Supabase reports the new columns as
 *  missing — say what to do instead of a raw schema error. */
export function migrationHint(error: { message?: string }): Error {
  const message = error.message ?? String(error);
  return /delivery|provider_job_id|completed_at/.test(message) && /column|schema cache/i.test(message)
    ? new Error("Batch needs its database columns first — run the \"Batch delivery\" SQL from supabase-schema.sql in the Supabase SQL Editor.")
    : new Error(message);
}

function sortLike(ids: string[], rows: Generation[]): Generation[] {
  return [...rows].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
}

export type BatchSyncSummary = {
  jobsChecked: number;
  stillRunning: number;
  completed: number;
  failed: number;
  errors: string[];
};

/** Checks every provider job that still has pending rows and saves whatever
 *  has finished. Safe to call often: a running job costs one status GET. */
export async function syncBatchJobs(): Promise<BatchSyncSummary> {
  const summary: BatchSyncSummary = { jobsChecked: 0, stillRunning: 0, completed: 0, failed: 0, errors: [] };

  const { data, error } = await db
    .from("generations")
    .select("id, brand_id, placement, provider_job_id, created_at, prompt_used")
    .eq("status", "pending")
    .eq("delivery", "batch");
  if (error) throw migrationHint(error);
  const pending = (data ?? []) as Pick<Generation, "id" | "brand_id" | "placement" | "provider_job_id" | "created_at" | "prompt_used">[];

  const now = Date.now();
  const orphans = pending.filter((r) => !r.provider_job_id && now - Date.parse(r.created_at) > ORPHAN_AFTER_MS);
  if (orphans.length) {
    await markFailed(orphans.map((r) => r.id), "Batch submission never finished.");
    summary.failed += orphans.length;
  }

  const byJob = new Map<string, typeof pending>();
  for (const row of pending) {
    if (!row.provider_job_id) continue;
    byJob.set(row.provider_job_id, [...(byJob.get(row.provider_job_id) ?? []), row]);
  }

  for (const [jobId, rows] of byJob) {
    summary.jobsChecked++;
    try {
      const result = await pollImageBatch(jobId);
      if (result.state === "running") {
        const oldest = Math.min(...rows.map((r) => Date.parse(r.created_at)));
        if (now - oldest > GIVE_UP_AFTER_MS) {
          await markFailed(rows.map((r) => r.id), "The provider never finished this batch (over 26 hours).");
          summary.failed += rows.length;
        } else {
          summary.stillRunning++;
        }
        continue;
      }
      if (result.state === "failed") {
        await markFailed(rows.map((r) => r.id), result.error);
        summary.failed += rows.length;
        continue;
      }

      const byKey = new Map(result.results.map((r) => [r.key, r]));
      for (const row of rows) {
        const item = byKey.get(row.id);
        if (item && "imageBase64" in item) {
          try {
            const imageUrl = await uploadGeneratedImage(row.brand_id, row.placement, item.imageBase64, item.mimeType);
            // Batch images are judged but not remade — a retry would cost the
            // full instant price and undo the batch saving.
            const prompt = row.prompt_used ?? "";
            const quality = await judgeImage({
              image: { base64: item.imageBase64, mimeType: item.mimeType },
              brief: prompt,
              expectedText: expectedTextFromPrompt(prompt),
              rules: prompt.includes(GLOBAL_DESIGN_RULE) ? GLOBAL_DESIGN_RULE : undefined,
            });
            const done = { status: "complete", image_url: imageUrl, error_message: null, completed_at: new Date().toISOString() };
            const withQuality = quality ? { ...done, quality_score: quality.score, quality_notes: qualityNote(quality), quality_attempts: 1 } : done;
            const { error: saveError } = await db.from("generations").update(withQuality).eq("id", row.id).eq("status", "pending");
            if (saveError && isMissingQualityColumn(saveError)) {
              await db.from("generations").update(done).eq("id", row.id).eq("status", "pending");
            } else if (saveError) throw saveError;
            summary.completed++;
          } catch (err) {
            await markFailed([row.id], `Saving the image failed: ${err instanceof Error ? err.message : String(err)}`);
            summary.failed++;
          }
        } else {
          await markFailed([row.id], item && "error" in item ? item.error : result.note ?? "The batch finished without this image.");
          summary.failed++;
        }
      }
    } catch (err) {
      // A status check that errors (network, provider outage) just retries next sync.
      summary.errors.push(`${jobId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return summary;
}

async function markFailed(ids: string[], message: string): Promise<void> {
  await db
    .from("generations")
    .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
    .in("id", ids)
    .eq("status", "pending");
}

export type BatchGroup = {
  batchId: string;
  brandId: string | null;
  createdAt: string;
  modelUsed: string | null;
  rows: Generation[];
};

/** Batch-delivered generations grouped by the app's batch id, newest first. */
export async function listBatchGroups(limit = 30): Promise<BatchGroup[]> {
  const { data, error } = await db
    .from("generations")
    .select("*")
    .eq("delivery", "batch")
    .order("created_at", { ascending: false })
    .limit(limit * 6);
  if (error) throw migrationHint(error);

  const groups = new Map<string, BatchGroup>();
  for (const row of (data ?? []) as Generation[]) {
    const group = groups.get(row.batch_id) ?? { batchId: row.batch_id, brandId: row.brand_id, createdAt: row.created_at, modelUsed: row.model_used, rows: [] };
    group.rows.push(row);
    groups.set(row.batch_id, group);
  }
  return [...groups.values()].slice(0, limit);
}
