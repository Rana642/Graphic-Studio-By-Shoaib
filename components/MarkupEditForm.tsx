"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GenerationResults, { type ResultRow } from "./GenerationResults";
import ComplexityChoice, { type ComplexityValue } from "./ComplexityChoice";

type Tool = "brush" | "rect" | "ellipse" | "arrow";
type Pt = { x: number; y: number }; // 0–1 of the image
type Shape = { tool: Tool; color: string; width: number; points: Pt[] };

type Source = { img: HTMLImageElement; width: number; height: number; url: string };

type ApiResponse = { results?: ResultRow[]; error?: string };

/** Longest side sent to the server; keeps the request small and well under the pixel limit. */
const MAX_SIDE = 2048;
const TOOLS: { id: Tool; label: string }[] = [
  { id: "brush", label: "Brush" },
  { id: "rect", label: "Rectangle" },
  { id: "ellipse", label: "Ellipse" },
  { id: "arrow", label: "Arrow" },
];
const WIDTHS = [
  { value: 1, label: "Thin" },
  { value: 2, label: "Medium" },
  { value: 4, label: "Thick" },
];
const TIER_COST = { draft: 0.006, standard: 0.053, premium: 0.21 } as const;

function drawShape(ctx: CanvasRenderingContext2D, s: Shape, w: number, h: number) {
  const base = Math.max(4, Math.round(Math.min(w, h) * 0.006));
  ctx.strokeStyle = s.color;
  ctx.lineWidth = base * s.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const [a, b] = [s.points[0], s.points[s.points.length - 1]];
  if (!a || !b) return;
  ctx.beginPath();
  if (s.tool === "brush") {
    ctx.moveTo(a.x * w, a.y * h);
    for (const p of s.points) ctx.lineTo(p.x * w, p.y * h);
  } else if (s.tool === "rect") {
    ctx.rect(a.x * w, a.y * h, (b.x - a.x) * w, (b.y - a.y) * h);
  } else if (s.tool === "ellipse") {
    ctx.ellipse(((a.x + b.x) / 2) * w, ((a.y + b.y) / 2) * h, (Math.abs(b.x - a.x) * w) / 2, (Math.abs(b.y - a.y) * h) / 2, 0, 0, Math.PI * 2);
  } else {
    const [x1, y1, x2, y2] = [a.x * w, a.y * h, b.x * w, b.y * h];
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = ctx.lineWidth * 5;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.moveTo(x2 - head * Math.cos(angle - 0.45), y2 - head * Math.sin(angle - 0.45));
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(angle + 0.45), y2 - head * Math.sin(angle + 0.45));
  }
  ctx.stroke();
}

export default function MarkupEditForm({ brands }: { brands: { id: string; name: string }[] }) {
  const [source, setSource] = useState<Source | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [tool, setTool] = useState<Tool>("rect");
  const [color, setColor] = useState("#ff0000");
  const [width, setWidth] = useState(2);
  const [prompt, setPrompt] = useState("");
  const [brandId, setBrandId] = useState("");
  const [tier, setTier] = useState<"draft" | "standard" | "premium">("standard");
  // Edits stay closest to the source at "low" (OpenAI's own advice for edits).
  const [complexity, setComplexity] = useState<ComplexityValue>("low");
  const [qualityCheck, setQualityCheck] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<Shape | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of [...shapes, ...(drawing.current ? [drawing.current] : [])]) drawShape(ctx, s, canvas.width, canvas.height);
  }, [shapes]);

  useEffect(redraw, [redraw, source]);

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      setSource({ img, width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale), url });
      setShapes([]);
      setResponse(null);
      setError(null);
    };
    img.src = url;
  };

  const pointOf = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = { tool, color, width, points: [pointOf(e)] };
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cur = drawing.current;
    if (!cur) return;
    cur.points = cur.tool === "brush" ? [...cur.points, pointOf(e)] : [cur.points[0], pointOf(e)];
    redraw();
  };
  const onUp = () => {
    const cur = drawing.current;
    drawing.current = null;
    if (cur && cur.points.length > 1) setShapes((prev) => [...prev, cur]);
    else redraw();
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!source || !canvas) return;
    if (shapes.length === 0) {
      setError("Draw at least one mark on the image first.");
      return;
    }
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const flat = document.createElement("canvas");
      flat.width = source.width;
      flat.height = source.height;
      flat.getContext("2d")?.drawImage(source.img, 0, 0, source.width, source.height);
      const res = await fetch("/api/markup-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: { base64: flat.toDataURL("image/jpeg", 0.92).split(",")[1], mimeType: "image/jpeg" },
          markupBase64: canvas.toDataURL("image/png").split(",")[1],
          prompt,
          tier,
          qualityCheck,
          ...(complexity ? { complexity } : {}),
          ...(brandId ? { brandId } : {}),
        }),
      });
      const json: ApiResponse = await res.json();
      if (!res.ok) setError(json.error || "Edit failed.");
      else setResponse(json);
    } catch {
      setError("Network error — check the dev server is running.");
    } finally {
      setLoading(false);
    }
  };

  const onEnhanced = (resultId: string, upscaledImageUrl: string) => {
    setResponse((prev) =>
      prev?.results ? { ...prev, results: prev.results.map((r) => (r.id === resultId ? { ...r, upscaled_image_url: upscaledImageUrl } : r)) } : prev
    );
  };

  const inputClass = "w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm";

  return (
    <div className="max-w-3xl">
      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <label className="mb-1.5 block text-sm text-muted">Image to edit</label>
          <input type="file" accept="image/png,image/jpeg,image/webp" required={!source} onChange={onPickImage} className="text-sm" />
        </div>

        {source && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTool(t.id)}
                  className={`rounded-lg border px-3 py-1.5 ${tool === t.id ? "border-accent ring-2 ring-accent/30" : "border-border"}`}
                >
                  {t.label}
                </button>
              ))}
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Mark colour" className="h-9 w-10 rounded border border-border bg-surface" />
              <select value={width} onChange={(e) => setWidth(Number(e.target.value))} aria-label="Mark thickness" className="rounded-lg border border-border bg-surface px-2 py-1.5">
                {WIDTHS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => setShapes((prev) => prev.slice(0, -1))} disabled={shapes.length === 0} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-50">
                Undo
              </button>
              <button type="button" onClick={() => setShapes([])} disabled={shapes.length === 0} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-50">
                Clear
              </button>
            </div>
            <div className="relative w-full overflow-hidden rounded-lg border border-border" style={{ aspectRatio: `${source.width} / ${source.height}` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={source.url} alt="Image to edit" className="absolute inset-0 size-full select-none" draggable={false} />
              <canvas
                ref={canvasRef}
                width={source.width}
                height={source.height}
                className="absolute inset-0 size-full cursor-crosshair touch-none"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
              />
            </div>
            <p className="text-xs text-muted">Draw on the places that should change. The marks only show where; they do not appear in the result.</p>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm text-muted">What should change?</label>
          <textarea
            className={inputClass}
            rows={3}
            required
            maxLength={2000}
            placeholder={'e.g. Change the headline to "MODERN MEN CHOOSE BETTER"'}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted">Put any exact words in quotes; the quality check reads them letter by letter.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm text-muted">Quality tier</label>
            <select className={inputClass} value={tier} onChange={(e) => setTier(e.target.value as typeof tier)}>
              <option value="draft">Draft (cheapest, concept check)</option>
              <option value="standard">Standard</option>
              <option value="premium">Premium (best quality)</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-muted">File under brand (optional)</label>
            <select className={inputClass} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              <option value="">No brand</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <ComplexityChoice value={complexity} onChange={setComplexity} />

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={qualityCheck} onChange={(e) => setQualityCheck(e.target.checked)} />
          <span>
            <span className="font-medium">Auto quality check</span>
            <span className="block text-xs text-muted">Scores the result (exact words, and that the rest stayed the same). One image only; no automatic retry.</span>
          </span>
        </label>

        {error && <p className="rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={loading || !source}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {loading ? "Editing…" : `Edit the marked places (~$${TIER_COST[tier].toFixed(3)})`}
        </button>
        <p className="text-xs text-muted">Delivery is always “Now”: GPT Image 2.6 has no Batch API.</p>
      </form>

      {response?.results && (
        <div className="mt-8">
          <GenerationResults results={response.results} onEnhanced={onEnhanced} showBatchesLink={false} />
        </div>
      )}
    </div>
  );
}
