import { listBrands } from "@/lib/brands";
import { listVideos, type VideoGeneration } from "@/lib/videos";

export const dynamic = "force-dynamic";

const STATUS: Record<VideoGeneration["status"], string> = {
  transcribed: "Being edited",
  rendered: "Ready",
  failed: "Failed",
};

export default async function VideosPage() {
  let videos: VideoGeneration[] = [];
  let setupError: string | null = null;
  try {
    videos = await listVideos();
  } catch (error) {
    setupError = error instanceof Error ? error.message : String(error);
  }
  const brands = new Map((await listBrands()).map((b) => [b.id, b.name]));

  return (
    <div>
      <h1 className="font-serif italic text-3xl tracking-tight">
        Videos<span className="text-accent not-italic font-sans font-bold">.</span>
      </h1>
      <p className="mt-2 text-muted">
        Branded videos edited with Video Studio — captions in the brand&apos;s font and colours, a logo end-card, and the
        transcription cost per video. Editing runs on this PC through Claude Code (studio_video_* tools + the video-use skill):
        drop raw clips in a folder and ask for a brand video.
      </p>

      {setupError ? (
        <p className="mt-8 rounded-xl border border-border bg-surface px-4 py-3 text-sm">{setupError}</p>
      ) : videos.length === 0 ? (
        <p className="mt-8 text-muted">No videos yet.</p>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {videos.map((v) => (
            <div key={v.id} className="rounded-xl border border-border bg-surface p-4">
              {v.output_url ? (
                <video src={v.output_url} controls preload="metadata" className="w-full rounded-lg bg-black" />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted">
                  {v.status === "rendered" ? "Saved on this PC" : STATUS[v.status]}
                </div>
              )}
              <div className="mt-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{v.title}</p>
                  <p className="text-sm text-muted">
                    {(v.brand_id && brands.get(v.brand_id)) || "No brand"} · {new Date(v.created_at).toLocaleDateString("en-GB")}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-xs">{STATUS[v.status]}</span>
              </div>
              <p className="mt-2 text-sm text-muted">
                {v.source_minutes != null && <>Raw {Number(v.source_minutes).toFixed(1)} min</>}
                {v.output_seconds != null && <> → final {Math.round(Number(v.output_seconds))}s</>}
                {v.est_cost_usd != null && <> · ${Number(v.est_cost_usd).toFixed(2)}</>}
              </p>
              {v.output_url ? (
                <a href={v.output_url} download className="mt-2 inline-block text-sm text-accent hover:underline">
                  Download →
                </a>
              ) : (
                v.output_path && <p className="mt-2 break-all text-xs text-muted">{v.output_path}</p>
              )}
              {v.status === "failed" && v.error && <p className="mt-2 line-clamp-3 text-xs text-red-700">{v.error}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
