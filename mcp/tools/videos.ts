import { z } from "zod";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getBrand } from "../../lib/brands.js";
import {
  SCRIBE_USD_PER_HOUR,
  brandVideoBrief,
  checkVideoToolchain,
  listSourceVideos,
  listVideos,
  probeSeconds,
  renderVideo,
  startVideo,
  videoUseDir,
} from "../../lib/videos.js";

function formatError(error: unknown): string {
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

const SKILL_NOTE = `This wraps video-use (the "video-use" skill): read its SKILL.md for the editing craft and hard rules. Flow: studio_video_start (transcribe + brand brief) → read edit/takes_packed.md → propose a plain-English plan and WAIT for the user's OK → write edit/edl.json (video-use EDL format) → studio_video_render with preview=true → self-check (timeline_view) → studio_video_render for the final.`;

export function registerVideoTools(server: McpServer): void {
  server.registerTool(
    "studio_video_brand_style",
    {
      title: "Video Studio — Brand Video Style",
      description: `Returns a brand's video style for editing: colours, font, voice notes, logo, contact, and the exact caption force_style Video Studio applies (brand font, white text, outline in the brand's primary colour). Also reports whether the local toolchain (video-use, ffmpeg, ElevenLabs key) is ready.

Args:
  - brandId (string, UUID): from studio_list_brands.

${SKILL_NOTE}`,
      inputSchema: { brandId: z.string().uuid() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ brandId }: { brandId: string }) => {
      try {
        const brand = await getBrand(brandId);
        if (!brand) throw new Error(`No brand ${brandId}.`);
        const problems = await checkVideoToolchain();
        const data = { style: brandVideoBrief(brand), toolchain: problems.length ? problems : "ready", videoUseDir: videoUseDir() };
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  server.registerTool(
    "studio_video_start",
    {
      title: "Video Studio — Start a Branded Video (transcribe)",
      description: `Step 1 for a brand video. Transcribes every video file in the footage folder with ElevenLabs Scribe (word-level, cached per file — re-running never pays twice for the same file), packs edit/takes_packed.md, writes edit/brand.json (the brand brief) and records the video for the brand.

COSTS MONEY (Scribe, about $${SCRIBE_USD_PER_HOUR.toFixed(2)} per audio hour). Without confirm=true it only lists the files, total minutes and the estimated cost.

Args:
  - brandId (string, UUID)
  - footageDir (string): absolute folder with the raw clips, e.g. "D:\\\\Clients\\\\Hotel Elegant\\\\Reel 1".
  - title (string, optional): name for the video (defaults to the folder name).
  - confirm (boolean): true to actually transcribe.

Returns the video id (needed for studio_video_render), the clip list, the packed transcript and the brand brief.

${SKILL_NOTE}`,
      inputSchema: {
        brandId: z.string().uuid(),
        footageDir: z.string().min(1),
        title: z.string().max(200).optional(),
        confirm: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (p: { brandId: string; footageDir: string; title?: string; confirm?: boolean }) => {
      try {
        if (!p.confirm) {
          const files = listSourceVideos(path.resolve(p.footageDir));
          let seconds = 0;
          for (const f of files) seconds += await probeSeconds(f);
          const minutes = seconds / 60;
          return {
            content: [
              {
                type: "text",
                text: `PREVIEW ONLY — nothing transcribed. ${files.length} clip(s), ${minutes.toFixed(1)} min, est. Scribe cost $${((minutes / 60) * SCRIBE_USD_PER_HOUR).toFixed(2)}.\n${files.map((f) => `- ${path.basename(f)}`).join("\n")}\nRe-run with confirm=true to transcribe.`,
              },
            ],
          };
        }
        const res = await startVideo(p);
        return {
          content: [
            {
              type: "text",
              text: `Video ${res.video.id} ready to edit (${res.sources.length} clip(s), ${res.video.source_minutes} min, est. $${res.video.est_cost_usd}).\nEdit dir: ${res.video.edit_dir}\n\nBrand brief:\n${JSON.stringify(res.brief, null, 2)}\n\n--- takes_packed.md ---\n${res.packed.slice(0, 60000)}`,
            },
          ],
          structuredContent: { video: res.video, sources: res.sources },
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  server.registerTool(
    "studio_video_render",
    {
      title: "Video Studio — Render a Branded Video",
      description: `Step 2: renders edit/edl.json (written by the editor per the video-use skill, only after the user approved the plan) with the brand's caption style. The final render also appends a short logo end-card on the brand colour, uploads the video (when under ~45 MB; larger files stay local) and marks the video rendered.

Args:
  - videoId (string, UUID): from studio_video_start.
  - preview (boolean, optional): fast 720p preview, nothing uploaded or recorded.
  - subtitles (boolean, optional, default true): burn captions in the brand style.
  - endCardSeconds (number, optional, default 2.5, 0 = none).

${SKILL_NOTE}`,
      inputSchema: {
        videoId: z.string().uuid(),
        preview: z.boolean().optional(),
        subtitles: z.boolean().optional(),
        endCardSeconds: z.number().min(0).max(8).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (p: { videoId: string; preview?: boolean; subtitles?: boolean; endCardSeconds?: number }) => {
      try {
        const res = await renderVideo(p);
        return {
          content: [
            {
              type: "text",
              text: `${p.preview ? "Preview" : "Final"} rendered: ${res.output} (${res.seconds.toFixed(1)}s)${res.url ? `\nUploaded: ${res.url}` : p.preview ? "" : "\nNot uploaded (over the size limit) — the file stays local."}`,
            },
          ],
          structuredContent: { output: res.output, seconds: res.seconds, url: res.url },
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  server.registerTool(
    "studio_list_videos",
    {
      title: "Video Studio — List Videos",
      description: "Lists Video Studio videos (newest first), optionally for one brand: title, status (transcribed / rendered / failed), minutes, output path/URL and estimated cost.",
      inputSchema: { brandId: z.string().uuid().optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ brandId }: { brandId?: string }) => {
      try {
        const videos = await listVideos(brandId);
        return { content: [{ type: "text", text: JSON.stringify(videos, null, 2) }], structuredContent: { videos } };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );
}
