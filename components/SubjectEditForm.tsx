"use client";

import { useState } from "react";
import { PLACEMENTS } from "@/lib/placements";
import GenerationResults, { type ResultRow } from "./GenerationResults";
import DeliveryChoice, { deliveryMultiplier, type Delivery } from "./DeliveryChoice";

type ApiResponse = {
  results?: ResultRow[];
  error?: string;
};

const REGULAR_TRACK_IDS = ["ig_feed", "ig_story", "meta_ad"];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function SubjectEditForm({
  brands,
}: {
  brands: { id: string; name: string }[];
}) {
  const [subjectImage, setSubjectImage] = useState<
    { base64: string; mimeType: string; previewUrl: string } | null
  >(null);
  const [sceneDescription, setSceneDescription] = useState("");
  const [brandId, setBrandId] = useState<string>("");
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

  const onPickSubjectImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSubjectImage({
      base64: await fileToBase64(file),
      mimeType: file.type || "image/png",
      previewUrl: URL.createObjectURL(file),
    });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectImage) return;
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch("/api/generate-subject-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectImage: { base64: subjectImage.base64, mimeType: subjectImage.mimeType },
          sceneDescription,
          provider,
          tier,
          placementIds,
          delivery,
          ...(brandId ? { brandId } : {}),
        }),
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

  const estTotal =
    placementIds.length *
    { draft: 0.02, standard: 0.045, premium: 0.15 }[tier] *
    deliveryMultiplier(delivery);

  return (
    <div className="max-w-2xl">
      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <label className="mb-1.5 block text-sm text-muted">
            Subject photo (person or product — this stays visually unchanged)
          </label>
          <input type="file" accept="image/*" required={!subjectImage} onChange={onPickSubjectImage} className="text-sm" />
          {subjectImage && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={subjectImage.previewUrl}
              alt="Subject"
              className="mt-3 h-32 w-32 rounded-lg border border-border object-cover"
            />
          )}
        </div>

        <div>
          <label htmlFor="sceneDescription" className="mb-1.5 block text-sm text-muted">
            New scene / background
          </label>
          <textarea
            id="sceneDescription"
            required
            rows={4}
            value={sceneDescription}
            onChange={(e) => setSceneDescription(e.target.value)}
            placeholder="e.g. Moody industrial workshop wall with vintage brass gauges and pipes, dramatic side lighting"
            className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
          />
          <p className="mt-1.5 text-xs text-muted">
            Only the background/scene changes — the subject in the photo above is preserved, not
            redrawn.
          </p>
        </div>

        <div>
          <label htmlFor="brandId" className="mb-1.5 block text-sm text-muted">
            File under a brand (optional)
          </label>
          <select
            id="brandId"
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm"
          >
            <option value="">None — standalone</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
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
          disabled={loading || placementIds.length === 0 || !subjectImage}
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
          <GenerationResults results={response.results} onEnhanced={onEnhanced} />
        </div>
      )}
    </div>
  );
}
