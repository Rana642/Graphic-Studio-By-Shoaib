import "server-only";
import type { GenerateImageInput, GenerateImageResult, ImageProviderClient } from "./types";

/**
 * FLUX 3 Image (Black Forest Labs, released 2026-10-01) — one model, three
 * output resolutions. Up to 10 reference images ride along as base64, so the
 * real product photo goes in exactly as it does for the other providers.
 * Costs are the public per-image prices from docs.bfl.ai on 2026-10-07; the
 * API also returns the credits it actually charged (1 credit = $0.01), which
 * is what gets recorded when present.
 */
const MODEL = "flux-3-image";
const RESOLUTION_BY_TIER: Record<GenerateImageInput["tier"], { resolution: "1k" | "1.5k" | "2k"; estCostUsd: number }> = {
  premium: { resolution: "2k", estCostUsd: 0.1 },
  standard: { resolution: "1.5k", estCostUsd: 0.07 },
  draft: { resolution: "1k", estCostUsd: 0.048 },
};

const API_KEY = process.env.BFL_API_KEY || "";
const ENDPOINT = "https://api.bfl.ai/v1/flux-3-image";
const POLL_EVERY_MS = 1500;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

/** FLUX takes a fixed list of aspect ratios — pick the one nearest the target. */
const RATIOS = ["21:9", "2:1", "16:9", "3:2", "7:5", "4:3", "5:4", "1:1", "4:5", "3:4", "5:7", "2:3", "9:16", "1:2", "9:21"] as const;
function aspectRatioFor(width: number, height: number): string {
  const target = Math.log(width / height);
  const value = (r: string) => {
    const [w, h] = r.split(":").map(Number);
    return Math.abs(Math.log(w / h) - target);
  };
  return RATIOS.reduce((best, r) => (value(r) < value(best) ? r : best));
}

type Submit = { id?: string; polling_url?: string; cost?: number | null };
type Poll = { status?: string; result?: { sample?: string } | null; details?: unknown };

export const fluxProvider: ImageProviderClient = {
  provider: "flux",

  async generate(input: GenerateImageInput): Promise<GenerateImageResult> {
    if (!API_KEY) throw new Error("BFL_API_KEY is not configured.");
    const { resolution, estCostUsd } = RESOLUTION_BY_TIER[input.tier];
    const refs = input.referenceImages ?? [];

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "x-key": API_KEY, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        prompt: input.prompt,
        ...(refs.length ? { images: refs.slice(0, 10).map((r) => r.base64) } : {}),
        aspect_ratio: aspectRatioFor(input.placement.width, input.placement.height),
        resolution,
        // Off: a web/image search could pull in someone else's pack or logo.
        grounding: false,
      }),
    });
    if (!res.ok) throw new Error(`FLUX (${MODEL}) failed: ${res.status} ${await res.text()}`);
    const task = (await res.json()) as Submit;
    if (!task.polling_url) throw new Error(`FLUX (${MODEL}) returned no polling URL.`);

    // Always poll the returned URL — BFL routes each task to a region.
    const started = Date.now();
    let sample: string | undefined;
    while (!sample) {
      if (Date.now() - started > POLL_TIMEOUT_MS) throw new Error(`FLUX (${MODEL}) timed out after ${POLL_TIMEOUT_MS / 60000} minutes.`);
      await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
      const poll = await fetch(task.polling_url, { headers: { "x-key": API_KEY, accept: "application/json" } });
      if (!poll.ok) throw new Error(`FLUX poll failed: ${poll.status} ${await poll.text()}`);
      const json = (await poll.json()) as Poll;
      // A brand-new task can briefly read "Task not found" before it registers.
      const settling = json.status === "Task not found" && Date.now() - started < 15000;
      if (json.status === "Ready") sample = json.result?.sample;
      else if (json.status && !settling && !/Pending|Queued|Processing/i.test(json.status)) {
        throw new Error(`FLUX (${MODEL}) ${json.status}${json.details ? `: ${JSON.stringify(json.details).slice(0, 300)}` : ""}`);
      }
      if (json.status === "Ready" && !sample) throw new Error(`FLUX (${MODEL}) finished without an image URL.`);
    }

    // The signed sample URL lives 10 minutes — download it straight away.
    const img = await fetch(sample);
    if (!img.ok) throw new Error(`FLUX image download failed: ${img.status}`);
    const mimeType = (img.headers.get("content-type") ?? "image/jpeg").split(";")[0];
    return {
      imageBase64: Buffer.from(await img.arrayBuffer()).toString("base64"),
      mimeType,
      modelUsed: `${MODEL}-${resolution}`,
      estCostUsd: typeof task.cost === "number" ? task.cost / 100 : estCostUsd,
    };
  },

  async submitBatch() {
    throw new Error('FLUX has no Batch API — choose "Now" delivery for FLUX.');
  },

  async pollBatch() {
    throw new Error("FLUX has no Batch API, so there is no FLUX batch job to check.");
  },
};
