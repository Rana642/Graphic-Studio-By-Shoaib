"use client";

import { useState } from "react";
import { PLACEMENTS } from "@/lib/placements";
import EnhanceButton from "./EnhanceButton";

type ResultRow = {
  id: string;
  placement: string;
  status: "complete" | "failed";
  image_url: string | null;
  est_cost_usd: number | null;
  error_message: string | null;
  upscaled_image_url?: string | null;
};

type ApiResponse = {
  results?: ResultRow[];
  error?: string;
};

type RefImage = { id: string; base64: string; mimeType: string; previewUrl: string };

const REGULAR_TRACK_IDS = ["ig_feed", "ig_story", "meta_ad"];
const MAX_REFERENCE_IMAGES = 4;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function PromptGenerateForm({
  brands,
}: {
  brands: { id: string; name: string }[];
}) {
  const [prompt, setPrompt] = useState("");
  const [brandId, setBrandId] = useState<string>("");
  const [provider, setProvider] = useState<"nano-banana" | "gpt-image">("nano-banana");
  const [tier, setTier] = useState<"draft" | "standard" | "premium">("standard");
  const [placementIds, setPlacementIds] = useState<string[]>(REGULAR_TRACK_IDS);
  const [refImages, setRefImages] = useState<RefImage[]>([]);
  const [refError, setRefError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);

  const togglePlacement = (id: string) => {
    setPlacementIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const onAddReferenceImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    if (refImages.length + files.length > MAX_REFERENCE_IMAGES) {
      setRefError(`Max ${MAX_REFERENCE_IMAGES} reference images.`);
      return;
    }
    setRefError(null);

    const next = await Promise.all(
      files.map(async (file) => ({
        id: crypto.randomUUID(),
        base64: await fileToBase64(file),
        mimeType: file.type || "image/png",
        previewUrl: URL.createObjectURL(file),
      }))
    );
    setRefImages((prev) => [...prev, ...next]);
  };

  const removeReferenceImage = (id: string) => {
    setRefImages((prev) => {
      const found = prev.find((r) => r.id === id);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((r) => r.id !== id);
    });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch("/api/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          provider,
          tier,
          placementIds,
          ...(brandId ? { brandId } : {}),
          ...(refImages.length > 0
            ? { referenceImages: refImages.map((r) => ({ base64: r.base64, mimeType: r.mimeType })) }
            : {}),
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

  const estTotal =
    placementIds.length *
    { draft: 0.02, standard: 0.045, premium: 0.15 }[tier];

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
          <label htmlFor="prompt" className="mb-1.5 block text-sm text-muted">
            Prompt
          </label>
          <textarea
            id="prompt"
            required
            rows={5}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the entire graphic — layout, text, colors, mood. Nothing is added on top of this: no brand colors, no voice, no auto-generated copy."
            className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-muted">
            Reference images (optional, up to {MAX_REFERENCE_IMAGES})
          </label>
          <input type="file" accept="image/*" multiple onChange={onAddReferenceImages} className="text-sm" />
          <p className="mt-1.5 text-xs text-muted">
            Attached directly to this generation for style matching — not saved anywhere else.
          </p>
          {refError && <p className="mt-1.5 text-xs text-danger">{refError}</p>}
          {refImages.length > 0 && (
            <div className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-6">
              {refImages.map((r) => (
                <div key={r.id} className="group relative rounded-lg border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r.previewUrl}
                    alt=""
                    className="aspect-square w-full rounded-lg object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeReferenceImage(r.id)}
                    className="absolute right-1.5 top-1.5 rounded-md bg-danger/90 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
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
          <p className="mt-1.5 text-xs text-muted">
            Only for organizing history and pulling that brand&apos;s saved reference images into
            the generation too — its colors/voice are never added to the prompt.
          </p>
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
            ? "Generating…"
            : `Generate ${placementIds.length} size${placementIds.length === 1 ? "" : "s"} (~$${estTotal.toFixed(2)})`}
        </button>
      </form>

      {response?.results && (
        <div className="mt-10">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {response.results.map((r) => (
              <div key={r.id} className="rounded-xl border border-border bg-surface p-3">
                {r.status === "complete" && r.image_url ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={r.upscaled_image_url || r.image_url}
                      alt={r.placement}
                      className="w-full rounded-lg"
                    />
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="text-muted">{r.placement}</span>
                      <a
                        href={r.upscaled_image_url || r.image_url}
                        download
                        className="text-accent hover:underline"
                      >
                        Download{r.upscaled_image_url ? " (enhanced)" : ""}
                      </a>
                    </div>
                    {r.upscaled_image_url ? (
                      <p className="mt-2 text-xs text-muted">✨ Enhanced with Topaz</p>
                    ) : (
                      <EnhanceButton generationId={r.id} onEnhanced={(url) => onEnhanced(r.id, url)} />
                    )}
                  </>
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
      )}
    </div>
  );
}
