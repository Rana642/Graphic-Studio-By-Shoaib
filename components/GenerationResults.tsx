"use client";

import { useState } from "react";
import Link from "next/link";
import EnhanceButton from "./EnhanceButton";

export type ResultRow = {
  id: string;
  placement: string;
  status: "pending" | "complete" | "failed";
  image_url: string | null;
  est_cost_usd: number | null;
  error_message: string | null;
  upscaled_image_url?: string | null;
  quality_score?: number | null;
  quality_notes?: string | null;
  quality_attempts?: number | null;
  /** Exact-text designs: the saved recipe; its presence enables "Edit text". */
  layout_json?: { content?: { label?: string; hook?: string; cta?: string }; report?: { contrastPass?: boolean; notes?: string[] } } | null;
};

/** The vision quality gate's verdict under an image (lib/quality-gate.ts). */
export function QualityBadge({ r }: { r: ResultRow }) {
  if (r.quality_score == null) return null;
  const passed = r.quality_score >= 70 && !/^Text:/.test(r.quality_notes ?? "");
  const retried = (r.quality_attempts ?? 1) > 1;
  return (
    <p className={`mt-2 text-xs ${passed ? "text-muted" : "text-danger"}`} title={r.quality_notes ?? ""}>
      {passed ? "✓" : "⚠"} Quality {r.quality_score}/100{retried ? " · auto-fixed once" : ""}
      {!passed && r.quality_notes ? <span className="mt-0.5 block text-muted">{r.quality_notes}</span> : null}
    </p>
  );
}

/** Exact-text designs: change the words without touching the AI background (free, instant). */
function EditText({ row, onEdited }: { row: ResultRow; onEdited: (id: string, row: ResultRow) => void }) {
  const saved = row.layout_json?.content ?? {};
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(saved.label ?? "");
  const [hook, setHook] = useState(saved.hook ?? "");
  const [cta, setCta] = useState(saved.cta ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/generate/recompose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId: row.id, label, hook, cta }),
      });
      const json: { result?: ResultRow; error?: string } = await res.json();
      if (!res.ok || !json.result) setError(json.error || "Couldn't change the text.");
      else {
        onEdited(row.id, json.result);
        setOpen(false);
      }
    } catch {
      setError("Network error — check the dev server is running.");
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 text-xs text-accent hover:underline">
        Edit text (free)
      </button>
    );

  const field = "w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm";
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border bg-background p-3">
      <input className={field} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Badge label" maxLength={60} />
      <input className={field} value={hook} onChange={(e) => setHook(e.target.value)} placeholder="Headline" maxLength={200} />
      <input className={field} value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Button text" maxLength={60} />
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2 text-sm">
        <button type="button" onClick={apply} disabled={busy || !hook.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-accent-foreground disabled:opacity-60">
          {busy ? "Applying…" : "Apply"}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="rounded-lg border border-border px-3 py-1.5">
          Cancel
        </button>
      </div>
      <p className="text-xs text-muted">Same background, new words. No AI call, no cost.</p>
    </div>
  );
}

/** Result grid shared by the generate forms and the Batches page: a finished
 *  image (download + enhance), a batch image still in the provider's queue,
 *  or a failure with its reason. */
export default function GenerationResults({
  results,
  onEnhanced,
  onEdited,
  showBatchesLink = true,
}: {
  results: ResultRow[];
  onEnhanced: (resultId: string, upscaledImageUrl: string) => void;
  /** Given only where a text edit can update the list (the generate forms). */
  onEdited?: (resultId: string, row: ResultRow) => void;
  showBatchesLink?: boolean;
}) {
  const pending = results.filter((r) => r.status === "pending").length;

  return (
    <div>
      {pending > 0 && showBatchesLink && (
        <p className="mb-4 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
          {pending} image{pending === 1 ? " is" : "s are"} queued in the batch — ready within 24 hours at half price.
          Follow {pending === 1 ? "it" : "them"} on the{" "}
          <Link href="/batches" className="font-medium underline">
            Batches page
          </Link>
          .
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {results.map((r) => (
          <div key={r.id} className="rounded-xl border border-border bg-surface p-3">
            {r.status === "complete" && r.image_url ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.upscaled_image_url || r.image_url} alt={r.placement} className="w-full rounded-lg" />
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-muted">{r.placement}</span>
                  <a href={r.upscaled_image_url || r.image_url} download className="text-accent hover:underline">
                    Download{r.upscaled_image_url ? " (enhanced)" : ""}
                  </a>
                </div>
                <QualityBadge r={r} />
                {r.layout_json?.report && r.layout_json.report.contrastPass === false ? (
                  <p className="mt-2 text-xs text-danger">
                    ⚠ {r.layout_json.report.notes?.[0] ?? "Some letters sit on a busy part of the picture."}
                  </p>
                ) : null}
                {onEdited && r.layout_json && !r.upscaled_image_url ? <EditText key={r.image_url} row={r} onEdited={onEdited} /> : null}
                {r.upscaled_image_url ? (
                  <p className="mt-2 text-xs text-muted">✨ Enhanced with Topaz</p>
                ) : (
                  <EnhanceButton generationId={r.id} onEnhanced={(url) => onEnhanced(r.id, url)} />
                )}
              </>
            ) : r.status === "pending" ? (
              <div className="flex h-32 flex-col items-center justify-center text-center text-sm">
                <p className="font-medium">⏳ {r.placement}</p>
                <p className="mt-1 text-xs text-muted">Queued in the batch</p>
              </div>
            ) : (
              <div className="flex h-32 flex-col items-center justify-center text-center text-sm text-danger">
                <p className="font-medium">{r.placement} failed</p>
                <p className="mt-1 text-xs text-muted">{r.error_message}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
