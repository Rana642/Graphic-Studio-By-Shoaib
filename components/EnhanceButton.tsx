"use client";

import { useState } from "react";

const SCALES = [2, 4, 6] as const;
type Scale = (typeof SCALES)[number];

export default function EnhanceButton({
  generationId,
  onEnhanced,
}: {
  generationId: string;
  onEnhanced: (upscaledImageUrl: string) => void;
}) {
  const [scale, setScale] = useState<Scale>(4);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId, scale }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Enhance failed.");
      } else {
        onEnhanced(json.generation.upscaled_image_url);
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2 flex items-center gap-2">
      <select
        value={scale}
        onChange={(e) => setScale(Number(e.target.value) as Scale)}
        disabled={loading}
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
      >
        {SCALES.map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="rounded-md border border-border px-2 py-1 text-xs font-medium transition-colors hover:bg-background disabled:opacity-60"
      >
        {loading ? "Enhancing…" : "Enhance (Topaz)"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
