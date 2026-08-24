"use client";

import { useState, useTransition } from "react";

/**
 * Two-step delete: the first click arms it, the second confirms. Avoids a
 * browser confirm() dialog while still making an irreversible action
 * deliberate rather than a stray click.
 */
export default function DeleteButton({
  action,
  label = "Delete brand",
  confirmLabel = "Click again to confirm",
}: {
  action: () => Promise<void>;
  label?: string;
  confirmLabel?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 4000);
      return;
    }
    startTransition(async () => {
      await action();
    });
  };

  return (
    <button
      onClick={onClick}
      disabled={pending}
      className="rounded-lg border border-danger/30 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-60"
    >
      {pending ? "Deleting…" : armed ? confirmLabel : label}
    </button>
  );
}
