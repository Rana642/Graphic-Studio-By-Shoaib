"use client";

export type Delivery = "instant" | "batch";

/** Batch = the provider's Batch API: same model and quality, half price,
 *  ready within 24 hours. Shared by every generate form. */
export const deliveryMultiplier = (delivery: Delivery) => (delivery === "batch" ? 0.5 : 1);

const OPTIONS: { value: Delivery; title: string; note: string }[] = [
  { value: "instant", title: "Now", note: "Full price — images in seconds" },
  { value: "batch", title: "Batch — 50% cheaper", note: "Same quality — ready within 24 hours (often much sooner)" },
];

export default function DeliveryChoice({
  value,
  onChange,
}: {
  value: Delivery;
  onChange: (value: Delivery) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-sm text-muted">Delivery</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {OPTIONS.map((o) => (
          <label
            key={o.value}
            className={`flex cursor-pointer items-start gap-2 rounded-lg border bg-surface px-3 py-2.5 text-sm transition-colors ${
              value === o.value ? "border-accent ring-2 ring-accent/30" : "border-border"
            }`}
          >
            <input
              type="radio"
              name="delivery"
              className="mt-0.5"
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span>
              <span className="block font-medium">{o.title}</span>
              <span className="block text-xs text-muted">{o.note}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
