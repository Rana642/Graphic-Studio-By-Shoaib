"use client";

import { useActionState } from "react";
import type { Brand } from "@/lib/brands";

const inputClasses =
  "w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors";
const labelClasses = "mb-1.5 block text-sm text-muted";

export default function BrandForm({
  brand,
  action,
}: {
  brand?: Brand;
  action: (formData: FormData) => Promise<{ error?: string } | void>;
}) {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string } | null, formData: FormData) => (await action(formData)) ?? null,
    null
  );

  return (
    <form action={formAction} className="max-w-xl space-y-5">
      <div>
        <label htmlFor="name" className={labelClasses}>
          Brand name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={brand?.name}
          className={inputClasses}
        />
      </div>

      <div>
        <label htmlFor="logo_url" className={labelClasses}>
          Logo URL (transparent PNG)
        </label>
        <input
          id="logo_url"
          name="logo_url"
          type="url"
          placeholder="https://…"
          defaultValue={brand?.logo_url ?? ""}
          className={inputClasses}
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label htmlFor="primary_hex" className={labelClasses}>
            Primary color
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              defaultValue={brand?.primary_hex ?? "#111111"}
              className="size-9 shrink-0 cursor-pointer rounded border border-border bg-transparent"
              onChange={(e) => {
                const input = e.currentTarget.parentElement?.querySelector<HTMLInputElement>(
                  'input[name="primary_hex"]'
                );
                if (input) input.value = e.currentTarget.value;
              }}
            />
            <input
              id="primary_hex"
              name="primary_hex"
              type="text"
              required
              defaultValue={brand?.primary_hex ?? "#111111"}
              className={inputClasses}
            />
          </div>
        </div>
        <div>
          <label htmlFor="secondary_hex" className={labelClasses}>
            Secondary
          </label>
          <input
            id="secondary_hex"
            name="secondary_hex"
            type="text"
            placeholder="#ffffff"
            defaultValue={brand?.secondary_hex ?? ""}
            className={inputClasses}
          />
        </div>
        <div>
          <label htmlFor="accent_hex" className={labelClasses}>
            Accent
          </label>
          <input
            id="accent_hex"
            name="accent_hex"
            type="text"
            placeholder="#eab308"
            defaultValue={brand?.accent_hex ?? ""}
            className={inputClasses}
          />
        </div>
      </div>

      <div>
        <label htmlFor="font_family" className={labelClasses}>
          Typography
        </label>
        <input
          id="font_family"
          name="font_family"
          type="text"
          placeholder="e.g. Inter, or “clean geometric sans”"
          defaultValue={brand?.font_family ?? ""}
          className={inputClasses}
        />
      </div>

      <div>
        <label htmlFor="voice_notes" className={labelClasses}>
          Brand voice / vibe
        </label>
        <textarea
          id="voice_notes"
          name="voice_notes"
          rows={3}
          placeholder="e.g. Minimalist corporate tech — no clutter, no stock-photo look."
          defaultValue={brand?.voice_notes ?? ""}
          className={inputClasses}
        />
      </div>

      {state?.error && (
        <p className="rounded-lg border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Saving…" : brand ? "Save changes" : "Add brand"}
      </button>
    </form>
  );
}
