"use client";

import { useActionState, useRef } from "react";
import type { BrandReference } from "@/lib/references";
import { uploadReferenceAction, deleteReferenceAction } from "@/lib/actions/references";

export default function ReferenceImages({
  brandId,
  references,
}: {
  brandId: string;
  references: BrandReference[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string } | null, formData: FormData) => {
      const result = await uploadReferenceAction(brandId, formData);
      if (!result?.error) formRef.current?.reset();
      return result ?? null;
    },
    null
  );

  return (
    <div>
      <p className="font-mono uppercase text-xs tracking-widest text-muted">
        Reference images
      </p>
      <p className="mt-1 text-sm text-muted">
        Existing posts or graphics for this brand — new generations (Nano Banana) are shown
        these for style consistency.
      </p>

      <form ref={formRef} action={formAction} className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="file" className="mb-1.5 block text-sm text-muted">
            Image
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept="image/*"
            required
            className="text-sm"
          />
        </div>
        <div>
          <label htmlFor="note" className="mb-1.5 block text-sm text-muted">
            Note (optional)
          </label>
          <input
            id="note"
            name="note"
            type="text"
            placeholder="e.g. Instagram feed style"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Uploading…" : "Upload"}
        </button>
      </form>

      {state?.error && (
        <p className="mt-3 rounded-lg border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      {references.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {references.map((ref) => (
            <div key={ref.id} className="group relative rounded-lg border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ref.image_url}
                alt={ref.note || "Reference"}
                className="aspect-square w-full rounded-lg object-cover"
              />
              {ref.note && (
                <p className="mt-1 truncate px-1 text-xs text-muted">{ref.note}</p>
              )}
              <form
                action={deleteReferenceAction.bind(null, ref.id, ref.image_url, brandId)}
              >
                <button
                  type="submit"
                  className="absolute right-1.5 top-1.5 rounded-md bg-danger/90 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  Delete
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
