import "server-only";
import type { UpscaleInput, UpscaleResult } from "./types";

/**
 * Sourced from https://developer.topazlabs.com/reference/api-endpoints/image/enhance.md
 * (2026-08-25). Submit → poll → download: the enhance call is async and
 * returns a process_id, not the image itself.
 */
const API_BASE = "https://api.topazlabs.com/image/v1";
const API_KEY = process.env.TOPAZ_API_KEY || "";

/** "Standard V2"/"High Fidelity V2" preserve the source (no invented
 *  detail) — the right default for real client photos and graphics with
 *  text that must not drift. "Text Refine" specifically sharpens rendered
 *  text/labels. "CGI" and "Low Resolution V2" suit other source types. */
export type TopazModel = "Standard V2" | "High Fidelity V2" | "Text Refine" | "CGI" | "Low Resolution V2";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

async function submitJob(input: UpscaleInput, model: TopazModel): Promise<string> {
  const ext = input.mimeType.split("/")[1] || "png";
  const form = new FormData();
  // Uint8Array.from (not the Buffer directly) avoids a Buffer→BlobPart type
  // mismatch (ArrayBufferLike includes SharedArrayBuffer, which BlobPart
  // rejects) that only surfaces under some tsconfig lib/target combos.
  form.append(
    "image",
    new Blob([Uint8Array.from(input.imageBuffer)], { type: input.mimeType }),
    `source.${ext}`
  );
  form.append("model", model);
  form.append("output_width", String(input.outputWidth));
  form.append("output_height", String(input.outputHeight));
  form.append("output_format", "png");

  const res = await fetch(`${API_BASE}/enhance/async`, {
    method: "POST",
    headers: { "X-API-Key": API_KEY },
    body: form,
  });
  if (!res.ok) throw new Error(`Topaz enhance submit failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (!json.process_id) throw new Error("Topaz enhance submit returned no process_id.");
  return json.process_id as string;
}

async function waitForCompletion(processId: string): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${API_BASE}/status/${processId}`, {
      headers: { "X-API-Key": API_KEY },
    });
    if (!res.ok) throw new Error(`Topaz status check failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    if (json.status === "Completed") return;
    if (json.status === "Failed" || json.status === "Cancelled") {
      throw new Error(`Topaz enhance job ${String(json.status).toLowerCase()}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("Topaz enhance job timed out after 2 minutes.");
}

async function fetchResultUrl(processId: string): Promise<string> {
  const res = await fetch(`${API_BASE}/download/${processId}`, {
    headers: { "X-API-Key": API_KEY },
  });
  if (!res.ok) throw new Error(`Topaz download fetch failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (!json.url) throw new Error("Topaz download response had no url.");
  return json.url as string;
}

/** Rough ballpark only — Topaz bills in credits against your plan
 *  (Standard-family models: 1 credit per 24 output megapixels), and the
 *  $/credit rate depends on which plan you're on (shown at
 *  topazlabs.com/enhance-api, not published in the API docs). This assumes
 *  ~$0.20/credit; re-check your actual plan before relying on this for
 *  real budgeting, same caveat as the cost estimates in
 *  lib/image-providers/{nanoBanana,gptImage}.ts. */
function estimateCostUsd(outputWidth: number, outputHeight: number): number {
  const outputMegapixels = (outputWidth * outputHeight) / 1_000_000;
  const credits = outputMegapixels / 24;
  return credits * 0.2;
}

export async function upscaleWithTopaz(
  input: UpscaleInput,
  model: TopazModel = "Standard V2"
): Promise<UpscaleResult> {
  if (!API_KEY) throw new Error("TOPAZ_API_KEY is not configured.");

  const processId = await submitJob(input, model);
  await waitForCompletion(processId);
  const resultUrl = await fetchResultUrl(processId);

  const imageRes = await fetch(resultUrl);
  if (!imageRes.ok) throw new Error(`Topaz result download failed: ${imageRes.status}`);
  const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

  return {
    imageBuffer,
    mimeType: "image/png",
    estCostUsd: estimateCostUsd(input.outputWidth, input.outputHeight),
  };
}
