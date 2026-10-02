"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import GenerationResults, { type ResultRow } from "./GenerationResults";

/** Re-runs the page (which syncs with the providers) every minute while
 *  something is still queued, plus a manual "Check now". */
export function BatchesRefresher({ hasPending }: { hasPending: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [checkedAt, setCheckedAt] = useState(() => new Date());

  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => {
      startTransition(() => router.refresh());
      setCheckedAt(new Date());
    }, 60_000);
    return () => clearInterval(timer);
  }, [hasPending, router]);

  return (
    <div className="flex items-center gap-3 text-sm text-muted">
      <span>
        {isPending ? "Checking…" : `Checked ${checkedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
        {hasPending && !isPending ? " · auto-checks every minute" : ""}
      </span>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          startTransition(() => router.refresh());
          setCheckedAt(new Date());
        }}
        className="rounded-lg border border-border px-3 py-1.5 font-medium text-foreground transition-colors hover:bg-surface disabled:opacity-60"
      >
        Check now
      </button>
    </div>
  );
}

export function BatchGroupResults({ results }: { results: ResultRow[] }) {
  const router = useRouter();
  return <GenerationResults results={results} showBatchesLink={false} onEnhanced={() => router.refresh()} />;
}
