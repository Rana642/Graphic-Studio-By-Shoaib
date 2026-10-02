import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "./supabase/db";
import { getBrand, type Brand } from "./brands";

/**
 * Video Studio — branded video editing on top of video-use
 * (github.com/Rana642/video-use, a fork of browser-use/video-use).
 *
 * video-use stays in its own clone (VIDEO_USE_DIR, default
 * ~/Developer/video-use) and is never copied in here, so `git pull` there
 * keeps it current. This module only *calls* its helpers (transcribe_batch,
 * pack_transcripts, render) and adds the brand layer: caption style from the
 * brand kit (VIDEO_USE_SUB_FORCE_STYLE), an optional logo end-card, upload,
 * and a cost record per video.
 *
 * Local-only by design: ffmpeg, Python and multi-minute renders can't run on
 * Vercel. It runs through the local MCP server (and is listed read-only in
 * the app's /videos page).
 */

export type VideoStatus = "transcribed" | "rendered" | "failed";

export type VideoGeneration = {
  id: string;
  brand_id: string | null;
  title: string;
  source_dir: string;
  edit_dir: string;
  status: VideoStatus;
  source_minutes: number | null;
  output_seconds: number | null;
  output_path: string | null;
  output_url: string | null;
  est_cost_usd: number | null;
  error: string | null;
  created_at: string;
  rendered_at: string | null;
};

const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mts"]);

/** ElevenLabs Scribe price per audio hour (set VIDEO_SCRIBE_USD_PER_HOUR to
 *  your plan's real rate). Only transcription costs money; rendering is local. */
export const SCRIBE_USD_PER_HOUR = Number(process.env.VIDEO_SCRIBE_USD_PER_HOUR || "0.40");

export function videoUseDir(): string {
  return process.env.VIDEO_USE_DIR || path.join(os.homedir(), "Developer", "video-use");
}

/** ffmpeg installed by winget lands in a user PATH that processes started
 *  before the install don't see — find it so the helpers always do. */
function ffmpegDir(): string | null {
  if (process.env.FFMPEG_DIR) return process.env.FFMPEG_DIR;
  const root = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages");
  if (!existsSync(root)) return null;
  for (const pkg of readdirSync(root).filter((d) => d.startsWith("Gyan.FFmpeg"))) {
    const inner = path.join(root, pkg);
    for (const build of readdirSync(inner)) {
      const bin = path.join(inner, build, "bin");
      if (existsSync(path.join(bin, "ffmpeg.exe"))) return bin;
    }
  }
  return null;
}

function helperEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const ff = ffmpegDir();
  return { ...process.env, ...(ff ? { PATH: `${ff}${path.delimiter}${process.env.PATH ?? ""}` } : {}), PYTHONIOENCODING: "utf-8", ...extra };
}

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? helperEnv(), windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${path.basename(args[0] ?? cmd)} failed (exit ${code}):\n${out.slice(-2000)}`))));
  });
}

const python = () => process.env.PYTHON_BIN || "python";
const helper = (name: string) => path.join(videoUseDir(), "helpers", name);

export async function probeSeconds(file: string): Promise<number> {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  return Number(out.trim()) || 0;
}

export function listSourceVideos(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`Footage folder not found: ${dir}`);
  return readdirSync(dir)
    .filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => path.join(dir, f));
}

/** Checks the local toolchain and says exactly what's missing. */
export async function checkVideoToolchain(): Promise<string[]> {
  const problems: string[] = [];
  if (!existsSync(helper("render.py"))) problems.push(`video-use not found at ${videoUseDir()} (set VIDEO_USE_DIR).`);
  try {
    await run("ffprobe", ["-version"]);
  } catch {
    problems.push("ffprobe/ffmpeg not found — install ffmpeg (winget install Gyan.FFmpeg) or set FFMPEG_DIR.");
  }
  const envFile = path.join(videoUseDir(), ".env");
  const hasKey = process.env.ELEVENLABS_API_KEY || (existsSync(envFile) && /^ELEVENLABS_API_KEY=.+/m.test(await readFile(envFile, "utf8")));
  if (!hasKey) problems.push(`ElevenLabs key missing — put ELEVENLABS_API_KEY=... in ${envFile}.`);
  return problems;
}

// ── Brand → video style ─────────────────────────────────────────────

/** "#RRGGBB" → ASS colour "&H00BBGGRR". */
function assColour(hex: string | null | undefined, fallback = "&H00FFFFFF"): string {
  const m = (hex ?? "").trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return fallback;
  const [r, g, b] = [m[1].slice(0, 2), m[1].slice(2, 4), m[1].slice(4, 6)];
  return `&H00${b}${g}${r}`.toUpperCase();
}

/** Caption style from the brand kit: brand font, white text, outline in the
 *  brand's primary colour — same safe-zone MarginV as video-use's default. */
export function brandSubtitleStyle(brand: Brand): string {
  const font = (brand.font_family || "Helvetica").split(",")[0].replace(/["']/g, "").trim() || "Helvetica";
  return [
    `FontName=${font}`,
    "FontSize=18",
    "Bold=1",
    "PrimaryColour=&H00FFFFFF",
    `OutlineColour=${assColour(brand.primary_hex, "&H00000000")}`,
    "BackColour=&H00000000",
    "BorderStyle=1",
    "Outline=2",
    "Shadow=0",
    "Alignment=2",
    "MarginV=90",
  ].join(",");
}

export function brandVideoBrief(brand: Brand) {
  return {
    brand: brand.name,
    colours: { primary: brand.primary_hex, secondary: brand.secondary_hex, accent: brand.accent_hex },
    font: brand.font_family,
    voice_notes: brand.voice_notes,
    logo_url: brand.logo_url,
    contact: { phone: brand.contact_phone, email: brand.contact_email, website: brand.website_url },
    subtitle_force_style: brandSubtitleStyle(brand),
  };
}

// ── Records ─────────────────────────────────────────────────────────

export async function listVideos(brandId?: string): Promise<VideoGeneration[]> {
  let q = db.from("video_generations").select("*").order("created_at", { ascending: false });
  if (brandId) q = q.eq("brand_id", brandId);
  const { data, error } = await q;
  if (error) throw new Error(tableHint(error.message));
  return (data ?? []) as VideoGeneration[];
}

export async function getVideo(id: string): Promise<VideoGeneration> {
  const { data, error } = await db.from("video_generations").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(tableHint(error.message));
  if (!data) throw new Error(`No video ${id}.`);
  return data as VideoGeneration;
}

function tableHint(msg: string) {
  return /video_generations/.test(msg) && /does not exist|schema cache/i.test(msg)
    ? "The video_generations table doesn't exist yet — run the Video Studio block of supabase-schema.sql in the Supabase SQL editor."
    : msg;
}

// ── Steps ───────────────────────────────────────────────────────────

/**
 * Step 1: transcribe every source video in the folder (cached per file by
 * video-use, so re-running doesn't pay twice), pack the phrase-level
 * transcript, write the brand brief next to it, and record the video.
 */
export async function startVideo(input: { brandId: string; footageDir: string; title?: string }) {
  const problems = await checkVideoToolchain();
  if (problems.length) throw new Error(problems.join("\n"));
  const brand = await getBrand(input.brandId);
  if (!brand) throw new Error(`No brand ${input.brandId}.`);

  const sourceDir = path.resolve(input.footageDir);
  const sources = listSourceVideos(sourceDir);
  if (!sources.length) throw new Error(`No video files (${[...VIDEO_EXT].join(", ")}) in ${sourceDir}.`);
  const editDir = path.join(sourceDir, "edit");
  await mkdir(editDir, { recursive: true });

  let seconds = 0;
  for (const s of sources) seconds += await probeSeconds(s);

  await run(python(), [helper("transcribe_batch.py"), sourceDir, "--edit-dir", editDir], { cwd: videoUseDir() });
  await run(python(), [helper("pack_transcripts.py"), "--edit-dir", editDir], { cwd: videoUseDir() });
  await writeFile(path.join(editDir, "brand.json"), JSON.stringify(brandVideoBrief(brand), null, 2));

  const minutes = seconds / 60;
  const { data, error } = await db
    .from("video_generations")
    .insert({
      brand_id: brand.id,
      title: input.title?.trim() || path.basename(sourceDir),
      source_dir: sourceDir,
      edit_dir: editDir,
      status: "transcribed",
      source_minutes: Number(minutes.toFixed(2)),
      est_cost_usd: Number(((minutes / 60) * SCRIBE_USD_PER_HOUR).toFixed(4)),
    })
    .select()
    .single();
  if (error) throw new Error(tableHint(error.message));

  const packed = await readFile(path.join(editDir, "takes_packed.md"), "utf8").catch(() => "");
  return { video: data as VideoGeneration, sources: sources.map((s) => path.basename(s)), packed, brief: brandVideoBrief(brand) };
}

async function downloadLogo(url: string, editDir: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ext = (res.headers.get("content-type") || "").includes("png") ? ".png" : ".jpg";
    const file = path.join(editDir, `brand-logo${ext}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    return file;
  } catch {
    return null;
  }
}

/** Appends a short brand end-card (logo centred on the brand colour) by
 *  re-encoding once — the card matches the video's size and frame rate. */
export async function appendEndCard(video: string, brand: Brand, editDir: string, seconds: number): Promise<string> {
  if (!brand.logo_url) return video;
  const logo = await downloadLogo(brand.logo_url, editDir);
  if (!logo) return video;
  const info = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-of", "csv=p=0", video]);
  const [w, h, rate] = info.trim().split(",");
  const bg = (brand.primary_hex || "#0f0f14").replace("#", "0x");
  const out = path.join(editDir, "final_branded.mp4");
  const logoW = Math.round(Number(w) * 0.42);
  await run("ffmpeg", [
    "-y", "-i", video, "-loop", "1", "-t", String(seconds), "-i", logo,
    "-f", "lavfi", "-t", String(seconds), "-i", `color=c=${bg}:s=${w}x${h}:r=${rate}`,
    "-f", "lavfi", "-t", String(seconds), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-filter_complex",
    `[1:v]scale=${logoW}:-1[lg];[2:v][lg]overlay=(W-w)/2:(H-h)/2,format=yuv420p,fade=t=in:st=0:d=0.4[card];` +
      `[0:v]format=yuv420p,setsar=1[v0];[card]setsar=1[v1];[0:a]aresample=48000[a0];[3:a]aresample=48000[a1];` +
      `[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`,
    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out,
  ]);
  return out;
}

const MAX_UPLOAD_BYTES = 45 * 1024 * 1024;

async function uploadVideo(brandId: string | null, file: string): Promise<string | null> {
  if (statSync(file).size > MAX_UPLOAD_BYTES) return null; // stays local; Supabase free tier caps files at 50 MB
  const { data: buckets } = await db.storage.listBuckets();
  if (!buckets?.some((b) => b.name === "videos")) await db.storage.createBucket("videos", { public: true });
  const key = `${brandId ?? "unbranded"}/${Date.now()}-${path.basename(file)}`;
  const { error } = await db.storage.from("videos").upload(key, await readFile(file), { contentType: "video/mp4", upsert: false });
  if (error) return null;
  return db.storage.from("videos").getPublicUrl(key).data.publicUrl;
}

/**
 * Step 2: render the EDL the editor wrote (edit/edl.json, per the video-use
 * skill) with the brand's caption style, optionally add the end-card,
 * upload, and mark the video rendered.
 */
export async function renderVideo(input: { videoId: string; preview?: boolean; subtitles?: boolean; endCardSeconds?: number }) {
  const video = await getVideo(input.videoId);
  const brand = video.brand_id ? await getBrand(video.brand_id) : null;
  const edl = path.join(video.edit_dir, "edl.json");
  if (!existsSync(edl)) throw new Error(`No ${edl} yet — write the EDL first (video-use skill), after the plan is approved.`);

  const out = path.join(video.edit_dir, input.preview ? "preview.mp4" : "final.mp4");
  const args = [helper("render.py"), edl, "-o", out];
  if (input.preview) args.push("--preview");
  if (input.subtitles !== false) args.push("--build-subtitles");
  else args.push("--no-subtitles");

  try {
    await run(python(), args, { cwd: video.source_dir, env: helperEnv(brand ? { VIDEO_USE_SUB_FORCE_STYLE: brandSubtitleStyle(brand) } : {}) });
    let finalFile = out;
    if (!input.preview && brand && (input.endCardSeconds ?? 2.5) > 0) finalFile = await appendEndCard(out, brand, video.edit_dir, input.endCardSeconds ?? 2.5);
    if (input.preview) return { video, output: finalFile, seconds: await probeSeconds(finalFile), url: null as string | null };

    const seconds = await probeSeconds(finalFile);
    const url = await uploadVideo(video.brand_id, finalFile);
    const { data, error } = await db
      .from("video_generations")
      .update({ status: "rendered", output_path: finalFile, output_url: url, output_seconds: Number(seconds.toFixed(2)), error: null, rendered_at: new Date().toISOString() })
      .eq("id", video.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { video: data as VideoGeneration, output: finalFile, seconds, url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from("video_generations").update({ status: "failed", error: message.slice(0, 2000) }).eq("id", video.id);
    throw error;
  }
}
