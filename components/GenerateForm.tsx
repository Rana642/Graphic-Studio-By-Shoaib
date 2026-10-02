"use client";

import { useState } from "react";
import { PLACEMENTS } from "@/lib/placements";
import GenerationResults, { type ResultRow } from "./GenerationResults";
import DeliveryChoice, { deliveryMultiplier, type Delivery } from "./DeliveryChoice";

type ApiResponse = {
  copy?: { label: string; hook: string; cta: string };
  results?: ResultRow[];
  error?: string;
};

const REGULAR_TRACK_IDS = ["ig_feed", "ig_story", "meta_ad"];

export default function GenerateForm({ brandId }: { brandId: string }) {
  const [offer, setOffer] = useState("");
  const [provider, setProvider] = useState<"nano-banana" | "gpt-image">("nano-banana");
  const [tier, setTier] = useState<"draft" | "standard" | "premium">("standard");
  const [delivery, setDelivery] = useState<Delivery>("instant");
  const [placementIds, setPlacementIds] = useState<string[]>(REGULAR_TRACK_IDS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);

  const togglePlacement = (id: string) => {
    setPlacementIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, offer, provider, tier, placementIds, delivery }),
      });
      const json: ApiResponse = await res.json();
      if (!res.ok) {
        setError(json.error || "Generation failed.");
      } else {
        setResponse(json);
      }
    } catch {
      setError("Network error — check the dev server is running.");
    } finally {
      setLoading(false);
    }
  };

  const estTotal =
    placementIds.length *
    { draft: 0.02, standard: 0.045, premium: 0.15 }[tier] *
    deliveryMultiplier(delivery);

  const onEnhanced = (resultId: string, upscaledImageUrl: string) => {
    setResponse((prev) =>
      prev?.results
        ? {
            ...prev,
            results: prev.results.map((r) =>
              r.id === resultId ? { ...r, upscaled_image_url: upscaledImageUrl } : r
            ),
          }
        : prev
    );
  };

  return (
    <div className="max-w-2xl">
      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <label htmlFor="offer" className="mb-1.5 block text-sm text-muted">
            What's the campaign / offer?
          </label>
          <textarea
            id="offer"
            required
            rows={3}
            value={offer}
            onChange={(e) => setOffer(e.target.value)}
            placeholder="e.g. 30% off leather boots this weekend only"
            className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-sm text-muted">Model</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as typeof provider)}
              className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm"
            >
              <option value="nano-banana">Nano Banana (Google)</option>
              <option value="gpt-image">GPT Image (OpenAI)</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-muted">Quality</label>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value as typeof tier)}
              className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm"
            >
              <option value="draft">Draft (cheapest, concept check)</option>
              <option value="standard">Standard</option>
              <option value="premium">Premium (best quality)</option>
            </select>
          </div>
        </div>

        <DeliveryChoice value={delivery} onChange={setDelivery} />

        <div>
          <p className="mb-2 text-sm text-muted">Sizes to generate</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PLACEMENTS.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={placementIds.includes(p.id)}
                  onChange={() => togglePlacement(p.id)}
                />
                {p.label}
              </label>
            ))}
          </div>
        </div>

        {error && (
          <p className="rounded-lg border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || placementIds.length === 0}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {loading
            ? delivery === "batch"
              ? "Queuing…"
              : "Generating…"
            : `${delivery === "batch" ? "Queue" : "Generate"} ${placementIds.length} size${placementIds.length === 1 ? "" : "s"} (~$${estTotal.toFixed(2)})`}
        </button>
      </form>

      {response?.results && (
        <div className="mt-10">
          {response.copy && (
            <p className="mb-4 text-sm text-muted">
              Copy: <span className="font-medium text-foreground">{response.copy.label}</span> ·{" "}
              {response.copy.hook} · {response.copy.cta}
            </p>
          )}
          <GenerationResults results={response.results} onEnhanced={onEnhanced} />
        </div>
      )}
    </div>
  );
}
