"use client";

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

/** Result grid shared by the generate forms and the Batches page: a finished
 *  image (download + enhance), a batch image still in the provider's queue,
 *  or a failure with its reason. */
export default function GenerationResults({
  results,
  onEnhanced,
  showBatchesLink = true,
}: {
  results: ResultRow[];
  onEnhanced: (resultId: string, upscaledImageUrl: string) => void;
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
