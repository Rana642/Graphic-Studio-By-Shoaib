"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { QualityBadge, type ResultRow } from "./GenerationResults";
import { deliveryMultiplier, type Delivery } from "./DeliveryChoice";

export type ConceptRow = ResultRow & {
  model_used?: string | null;
  approved_at?: string | null;
  finals: ResultRow[];
};

/** Per-image price of a final, by the concept's provider (lib/image-providers). */
const FINAL_PRICE = {
  "gpt-image": { standard: 0.045, premium: 0.19 },
  "nano-banana": { standard: 0.04, premium: 0.134 },
} as const;

/** Product Photoshoot steps 2 and 3: approve Draft concepts, then render the
 *  approved ones as Standard / Premium finals (instant or batch). */
export default function PhotoshootConcepts({ concepts: initial }: { concepts: ConceptRow[] }) {
  const router = useRouter();
  const [concepts, setConcepts] = useState(initial);
  const [tier, setTier] = useState<"standard" | "premium">("premium");
  const [delivery, setDelivery] = useState<Delivery>("instant");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const approved = concepts.filter((c) => c.approved_at && c.status === "complete");
  const provider = concepts[0]?.model_used?.startsWith("gemini") ? "nano-banana" : "gpt-image";
  const finalCost = approved.length * FINAL_PRICE[provider][tier] * deliveryMultiplier(delivery);

  const toggleApprove = async (c: ConceptRow) => {
    setBusy(c.id);
    setError(null);
    const approvedNow = !c.approved_at;
    try {
      const res = await fetch("/api/photoshoot/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, approved: approvedNow }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not save the approval.");
      setConcepts((prev) => prev.map((x) => (x.id === c.id ? { ...x, approved_at: approvedNow ? new Date().toISOString() : null } : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the approval.");
    } finally {
      setBusy(null);
    }
  };

  const finalize = async () => {
    setBusy("final");
    setError(null);
    try {
      const res = await fetch("/api/photoshoot/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conceptIds: approved.map((c) => c.id), tier, delivery }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Final render failed.");
      const finals: (ResultRow & { parent_generation_id?: string })[] = json.results ?? [];
      setConcepts((prev) => prev.map((c) => ({ ...c, finals: [...c.finals, ...finals.filter((f) => f.parent_generation_id === c.id)] })));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Final render failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {concepts.map((c) => (
          <div
            key={c.id}
            className={`rounded-xl border bg-surface p-3 ${c.approved_at ? "border-accent ring-2 ring-accent/30" : "border-border"}`}
          >
            {c.status === "complete" && c.image_url ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.image_url} alt={c.placement} className="w-full rounded-lg" />
                <QualityBadge r={c} />
                <button
                  type="button"
                  disabled={busy === c.id}
                  onClick={() => toggleApprove(c)}
                  className={`mt-2 w-full rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
                    c.approved_at ? "bg-accent text-accent-foreground" : "border border-border hover:bg-background"
                  }`}
                >
                  {c.approved_at ? "✓ Approved" : "Approve"}
                </button>
              </>
            ) : c.status === "pending" ? (
              <p className="py-10 text-center text-sm">⏳ Queued</p>
            ) : (
              <div className="py-6 text-center text-sm text-danger">
                <p className="font-medium">Failed</p>
                <p className="mt-1 text-xs text-muted">{c.error_message}</p>
              </div>
            )}

            {c.finals.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-border pt-3">
                <p className="text-xs font-medium">Final</p>
                {c.finals.map((f) =>
                  f.status === "complete" && f.image_url ? (
                    <div key={f.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.image_url} alt="final" className="w-full rounded-lg" />
                      <QualityBadge r={f} />
                      <a href={f.image_url} download className="mt-1 block text-xs text-accent hover:underline">
                        Download final
                      </a>
                    </div>
                  ) : f.status === "pending" ? (
                    <p key={f.id} className="text-xs text-muted">⏳ Final queued in the batch</p>
                  ) : (
                    <p key={f.id} className="text-xs text-danger">Final failed: {f.error_message}</p>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
        <span className="font-medium">
          {approved.length} approved
        </span>
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value as typeof tier)}
          className="rounded-lg border border-border bg-background px-3 py-1.5"
        >
          <option value="standard">Final: Standard</option>
          <option value="premium">Final: Premium</option>
        </select>
        <select
          value={delivery}
          onChange={(e) => setDelivery(e.target.value as Delivery)}
          className="rounded-lg border border-border bg-background px-3 py-1.5"
        >
          <option value="instant">Now</option>
          <option value="batch">Batch — 50% cheaper</option>
        </select>
        <button
          type="button"
          disabled={approved.length === 0 || busy === "final"}
          onClick={finalize}
          className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy === "final" ? "Making finals…" : `Make ${approved.length || ""} final${approved.length === 1 ? "" : "s"} (~$${finalCost.toFixed(2)})`}
        </button>
        {error && <span className="text-danger">{error}</span>}
      </div>
    </div>
  );
}
