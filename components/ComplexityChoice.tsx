"use client";

import type { Complexity } from "@/lib/image-providers/types";

/** "" = leave it out, so OpenAI uses its own default (high). */
export type ComplexityValue = Complexity | "";

const OPTIONS: { value: ComplexityValue; label: string }[] = [
  { value: "", label: "Default (high)" },
  { value: "low", label: "Low — fastest; the safest for edits" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High — plans most; slower" },
];

/** GPT Image 2.6 only: how much the model plans before drawing. Free to
 *  change; higher is slower and can alter more of an edit. Shared by the
 *  generate forms and shown only for GPT Image with "Now" delivery. */
export default function ComplexityChoice({
  value,
  onChange,
}: {
  value: ComplexityValue;
  onChange: (value: ComplexityValue) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm text-muted">Complexity (GPT Image 2.6)</span>
      <select
        className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value as ComplexityValue)}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
