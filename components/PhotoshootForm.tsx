"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PHOTOSHOOT_MODES, withDefaultAnswers, type PhotoshootModeId } from "@/lib/photoshoot-modes";

type Upload = { id: string; base64: string; mimeType: string; previewUrl: string };

const DRAFT_PRICE = { "gpt-image": 0.005, "nano-banana": 0.02 } as const;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Product Photoshoot step 1 — pick a mode, answer 1–2 questions, get cheap
 *  Draft concepts to approve (see lib/photoshoot.ts). */
export default function PhotoshootForm({ brands }: { brands: { id: string; name: string }[] }) {
  const router = useRouter();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [brandId, setBrandId] = useState("");
  const [modeId, setModeId] = useState<PhotoshootModeId>("product_shot");
  const mode = PHOTOSHOOT_MODES.find((m) => m.id === modeId)!;
  const [answers, setAnswers] = useState<Record<string, string>>(() => withDefaultAnswers(mode));
  const [count, setCount] = useState(mode.counts[0]);
  const [note, setNote] = useState("");
  const [withText, setWithText] = useState(false);
  const [headline, setHeadline] = useState("");
  const [cta, setCta] = useState("");
  const [provider, setProvider] = useState<"gpt-image" | "nano-banana">("gpt-image");
  const [qualityCheck, setQualityCheck] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const pickMode = (id: PhotoshootModeId) => {
    const m = PHOTOSHOOT_MODES.find((x) => x.id === id)!;
    setModeId(id);
    setAnswers(withDefaultAnswers(m));
    setCount(m.counts[0]);
  };

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, 3 - uploads.length);
    e.target.value = "";
    const next = await Promise.all(
      files.map(async (file) => ({ id: crypto.randomUUID(), base64: await fileToBase64(file), mimeType: file.type || "image/png", previewUrl: URL.createObjectURL(file) }))
    );
    setUploads((prev) => [...prev, ...next].slice(0, 3));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/photoshoot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: modeId,
          images: uploads.map((u) => ({ base64: u.base64, mimeType: u.mimeType })),
          ...(brandId ? { brandId } : {}),
          answers,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(withText && (headline.trim() || cta.trim()) ? { text: { headline: headline.trim() || undefined, cta: cta.trim() || undefined } } : {}),
          count,
          provider,
          qualityCheck,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Photoshoot failed.");
      const n = (json.results ?? []).filter((r: { status: string }) => r.status === "complete").length;
      setDone(`${n} concept${n === 1 ? "" : "s"} ready — approve them under Recent photoshoots.`);
      // The new photoshoot shows at the top of Recent photoshoots (one place
      // to approve and finalise), so refresh and scroll there.
      router.refresh();
      setTimeout(() => document.getElementById("recent")?.scrollIntoView({ behavior: "smooth" }), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photoshoot failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <form onSubmit={onSubmit} className="max-w-3xl space-y-6">
        <div>
          <p className="mb-1.5 text-sm text-muted">
            ① {mode.input === "source" ? "The image to restyle" : "Product photo(s) — front, side, back (up to 3)"}
          </p>
          <input type="file" accept="image/*" multiple={mode.input !== "source"} onChange={onFiles} className="text-sm" disabled={uploads.length >= 3} />
          {uploads.length > 0 && (
            <div className="mt-3 flex gap-3">
              {uploads.map((u) => (
                <div key={u.id} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u.previewUrl} alt="" className="h-24 w-24 rounded-lg border border-border object-cover" />
                  <button
                    type="button"
                    onClick={() => setUploads((prev) => prev.filter((x) => x.id !== u.id))}
                    className="absolute right-1 top-1 rounded bg-danger/90 px-1.5 text-xs text-white opacity-0 group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2 text-sm">
            <label htmlFor="ps-brand" className="text-muted">Brand (optional)</label>
            <select id="ps-brand" value={brandId} onChange={(e) => setBrandId(e.target.value)} className="rounded-lg border border-border bg-surface px-3 py-1.5">
              <option value="">None</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <span className="text-xs text-muted">adds its colours, and its logo when there is text</span>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm text-muted">② Mode</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {PHOTOSHOOT_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => pickMode(m.id)}
                className={`rounded-lg border bg-surface p-2.5 text-left text-xs transition-colors ${
                  m.id === modeId ? "border-accent ring-2 ring-accent/30" : "border-border hover:border-accent/40"
                }`}
              >
                <span className="block text-lg">{m.icon}</span>
                <span className="block font-medium text-foreground">{m.label}</span>
                <span className="mt-0.5 block text-muted">{m.short}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm text-muted">③ A few choices</p>
          {mode.questions.map((qq) => (
            <div key={qq.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-24 text-muted">{qq.label}</span>
              {qq.options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setAnswers((prev) => ({ ...prev, [qq.id]: o.value }))}
                  className={`rounded-full border px-3 py-1 transition-colors ${
                    answers[qq.id] === o.value ? "border-accent bg-accent/15 font-medium" : "border-border hover:bg-surface"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          ))}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Anything else? (optional) e.g. show healthy broilers, keep it bright"
            className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-sm"
          />
        </div>

        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={withText} onChange={(e) => setWithText(e.target.checked)} />
            ④ Put text on the image <span className="text-xs text-muted">(off = clean photos)</span>
          </label>
          {withText && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={120} placeholder="Headline" className="rounded-lg border border-border bg-surface px-3 py-2" />
              <input value={cta} onChange={(e) => setCta(e.target.value)} maxLength={40} placeholder="Button (optional), e.g. Order now" className="rounded-lg border border-border bg-surface px-3 py-2" />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="text-muted">⑤ How many</span>
          {mode.counts
            .slice()
            .sort((a, b) => a - b)
            .map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCount(n)}
                className={`rounded-full border px-3 py-1 ${count === n ? "border-accent bg-accent/15 font-medium" : "border-border"}`}
              >
                {n}
              </button>
            ))}
          <select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)} className="rounded-lg border border-border bg-surface px-3 py-1.5">
            <option value="gpt-image">GPT Image (OpenAI)</option>
            <option value="nano-banana">Nano Banana (Google)</option>
          </select>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={qualityCheck} onChange={(e) => setQualityCheck(e.target.checked)} />
          <span>
            <span className="font-medium">⑥ Auto quality check</span>
            <span className="block text-xs text-muted">AI checks each concept against the product and the text, and remakes a weak one once.</span>
          </span>
        </label>

        {error && <p className="rounded-lg border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}
        {done && <p className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm">✓ {done}</p>}

        <button
          type="submit"
          disabled={loading || uploads.length === 0}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {loading ? "Making concepts…" : `Make ${count} Draft concept${count === 1 ? "" : "s"} (~$${(count * DRAFT_PRICE[provider]).toFixed(3)})`}
        </button>
      </form>

    </div>
  );
}
