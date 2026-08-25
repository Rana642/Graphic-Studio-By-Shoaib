"use client";

import { useState } from "react";
import { ASSET_LOCKED_TEMPLATES } from "@/lib/asset-locked/templates";
import EnhanceButton from "./EnhanceButton";

type GenerationResult = {
  id: string;
  status: "complete" | "failed";
  image_url: string | null;
  error_message: string | null;
  upscaled_image_url?: string | null;
};

type ApiResponse = {
  generation?: GenerationResult;
  error?: string;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function AssetLockedForm({
  brands,
}: {
  brands: { id: string; name: string }[];
}) {
  const [templateId, setTemplateId] = useState<string>(ASSET_LOCKED_TEMPLATES[0]?.id ?? "");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<{ base64: string; mimeType: string; previewUrl: string } | null>(
    null
  );
  const [brandId, setBrandId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);

  const template = ASSET_LOCKED_TEMPLATES.find((t) => t.id === templateId) ?? ASSET_LOCKED_TEMPLATES[0];

  const onSelectTemplate = (id: string) => {
    setTemplateId(id);
    setFieldValues({});
    setResult(null);
  };

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhoto({
      base64: await fileToBase64(file),
      mimeType: file.type || "image/png",
      previewUrl: URL.createObjectURL(file),
    });
  };

  const onEnhanced = (upscaledImageUrl: string) => {
    setResult((prev) => (prev ? { ...prev, upscaled_image_url: upscaledImageUrl } : prev));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!photo || !template) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/generate-asset-locked", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: template.id,
          fieldValues,
          photo: { base64: photo.base64, mimeType: photo.mimeType },
          ...(brandId ? { brandId } : {}),
        }),
      });
      const json: ApiResponse = await res.json();
      if (!res.ok) {
        setError(json.error || "Generation failed.");
      } else if (json.generation) {
        setResult(json.generation);
      }
    } catch {
      setError("Network error — check the dev server is running.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <p className="mb-2 text-sm text-muted">Template</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ASSET_LOCKED_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelectTemplate(t.id)}
              className={`rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                t.id === templateId
                  ? "border-accent bg-accent/10"
                  : "border-border bg-surface hover:bg-background"
              }`}
            >
              <p className="font-medium">{t.label}</p>
              <p className="mt-1 text-xs text-muted">{t.description}</p>
            </button>
          ))}
        </div>
      </div>

      {template && (
        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <label className="mb-1.5 block text-sm text-muted">
              Property/event photo (composited as-is — never AI-touched)
            </label>
            <input type="file" accept="image/*" required={!photo} onChange={onPickPhoto} className="text-sm" />
            {photo && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={photo.previewUrl}
                alt="Selected"
                className="mt-3 h-32 w-32 rounded-lg border border-border object-cover"
              />
            )}
          </div>

          {template.fields.map((f) => (
            <div key={f.key}>
              <label htmlFor={f.key} className="mb-1.5 block text-sm text-muted">
                {f.label}
              </label>
              {f.kind === "long-text" ? (
                <textarea
                  id={f.key}
                  rows={3}
                  maxLength={f.maxLength}
                  value={fieldValues[f.key] ?? ""}
                  onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
                />
              ) : (
                <input
                  id={f.key}
                  type="text"
                  maxLength={f.maxLength}
                  dir={f.kind === "urdu" ? "rtl" : "ltr"}
                  placeholder={f.placeholder}
                  value={fieldValues[f.key] ?? ""}
                  onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
                />
              )}
            </div>
          ))}

          <div>
            <label htmlFor="brandId" className="mb-1.5 block text-sm text-muted">
              Brand (optional — colors/logo initial come from here)
            </label>
            <select
              id="brandId"
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm"
            >
              <option value="">None</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="rounded-lg border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !photo}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {loading ? "Generating…" : "Generate"}
          </button>
        </form>
      )}

      {result && (
        <div className="mt-10 rounded-xl border border-border bg-surface p-3">
          {result.status === "complete" && result.image_url ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.upscaled_image_url || result.image_url}
                alt="Result"
                className="w-full rounded-lg"
              />
              <div className="mt-2 flex items-center justify-end text-sm">
                <a
                  href={result.upscaled_image_url || result.image_url}
                  download
                  className="text-accent hover:underline"
                >
                  Download{result.upscaled_image_url ? " (enhanced)" : ""}
                </a>
              </div>
              {result.upscaled_image_url ? (
                <p className="mt-2 text-xs text-muted">✨ Enhanced with Topaz</p>
              ) : (
                <EnhanceButton generationId={result.id} onEnhanced={onEnhanced} />
              )}
            </>
          ) : (
            <div className="flex h-32 flex-col items-center justify-center text-center text-sm text-danger">
              <p className="font-medium">Generation failed</p>
              <p className="mt-1 text-xs text-muted">{result.error_message}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
