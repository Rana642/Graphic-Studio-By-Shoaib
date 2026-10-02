import { listBrands } from "@/lib/brands";
import { listBatchGroups, syncBatchJobs, type BatchGroup, type BatchSyncSummary } from "@/lib/batch-jobs";
import { BatchesRefresher, BatchGroupResults } from "@/components/BatchesClient";

export const dynamic = "force-dynamic";

const PROVIDER_LABEL = (model: string | null) =>
  !model ? "—" : model.startsWith("gemini") ? `Nano Banana · ${model}` : `GPT Image · ${model}`;

export default async function BatchesPage() {
  let sync: BatchSyncSummary | null = null;
  let groups: BatchGroup[] = [];
  let problem: string | null = null;
  try {
    // Every page load checks the providers first, so what's shown is current.
    sync = await syncBatchJobs();
    groups = await listBatchGroups();
  } catch (err) {
    problem = err instanceof Error ? err.message : String(err);
  }

  const brands = new Map((await listBrands()).map((b) => [b.id, b.name]));
  const hasPending = groups.some((g) => g.rows.some((r) => r.status === "pending"));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif italic text-3xl tracking-tight">
            Batches<span className="text-accent not-italic font-sans font-bold">.</span>
          </h1>
          <p className="mt-2 text-muted">
            Images queued with Batch delivery — half price, ready within 24 hours. This page checks with
            OpenAI and Google each time it loads.
          </p>
        </div>
        {!problem && <BatchesRefresher hasPending={hasPending} />}
      </div>

      {problem && (
        <p className="mt-8 rounded-lg border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">{problem}</p>
      )}
      {sync && sync.errors.length > 0 && (
        <p className="mt-6 rounded-lg border border-border bg-surface px-4 py-3 text-xs text-muted">
          Couldn&apos;t reach a provider just now (will retry on the next check): {sync.errors.join(" · ")}
        </p>
      )}

      {!problem && groups.length === 0 && (
        <p className="mt-8 text-muted">
          No batches yet. Pick <span className="font-medium text-foreground">Batch — 50% cheaper</span> under
          Delivery on any Generate page.
        </p>
      )}

      <div className="mt-8 space-y-10">
        {groups.map((g) => {
          const ready = g.rows.filter((r) => r.status === "complete").length;
          const waiting = g.rows.filter((r) => r.status === "pending").length;
          const failed = g.rows.filter((r) => r.status === "failed").length;
          const cost = g.rows.reduce((sum, r) => sum + (r.status === "failed" ? 0 : r.est_cost_usd || 0), 0);
          return (
            <section key={g.batchId} className="border-t border-border pt-6">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="font-medium">{g.brandId ? brands.get(g.brandId) ?? "Deleted brand" : "Standalone"}</h2>
                  <p className="text-xs text-muted">
                    {PROVIDER_LABEL(g.modelUsed)} · queued{" "}
                    {new Date(g.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </div>
                <p className="text-sm text-muted">
                  {ready} ready{waiting > 0 && ` · ${waiting} waiting`}
                  {failed > 0 && ` · ${failed} failed`} · ~${cost.toFixed(3)} (saved ~${cost.toFixed(3)})
                </p>
              </div>
              {g.rows[0]?.copy_hook && (
                <p className="mb-3 text-sm text-muted">
                  Copy: <span className="font-medium text-foreground">{g.rows[0].copy_label}</span> · {g.rows[0].copy_hook} ·{" "}
                  {g.rows[0].copy_cta}
                </p>
              )}
              <BatchGroupResults results={g.rows} />
            </section>
          );
        })}
      </div>
    </div>
  );
}
