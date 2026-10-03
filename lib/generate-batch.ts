import "server-only";
import { generateImage, type Delivery, type GenerateImageResult, type Provider, type Tier } from "./image-providers";
import type { Placement } from "./placements";
import { insertGeneration, uploadGeneratedImage, type Generation } from "./generations";
import { submitBatchGeneration } from "./batch-jobs";
import { renderContract, type PromptContract } from "./prompt-contract";
import { fixFromReview, judgeImage, qualityNote, type QualityResult } from "./quality-gate";

export type GenerationBatchInput = {
  brandId: string | null;
  prompt: string;
  provider: Provider;
  tier: Tier;
  placements: Placement[];
  referenceImages: { base64: string; mimeType: string }[];
  /** Only set for the brand-scoped Creative Track — free-prompt generations
   *  have no separate label/hook/cta, the prompt is the whole brief. */
  copy?: { label: string; hook: string; cta: string };
  /** Defaults to "creative" (matches the DB column default) if omitted. */
  track?: Generation["track"];
  /** "batch" = provider Batch API at half price; rows come back "pending"
   *  and complete later (see lib/batch-jobs.ts). Defaults to "instant". */
  delivery?: Delivery;
  /** The structured prompt `prompt` was rendered from (lib/prompt-contract.ts).
   *  A quality retry re-renders it with a FIX block; without one the fix is
   *  appended to the plain prompt. */
  contract?: PromptContract;
  /** Words the image must contain, checked letter by letter by the gate. */
  expectedText?: string[];
  /** Vision quality gate (lib/quality-gate.ts). Defaults to on. */
  qualityCheck?: boolean;
  /** Extra rules the judge applies (e.g. the global light/glass rule). */
  qualityRules?: string;
};

/** How many images one placement may cost when the gate fails: the first
 *  plus one retry with the reviewer's fix hint. */
const MAX_ATTEMPTS = 2;

type Attempt = { image: GenerateImageResult; quality: QualityResult | null };

/** Images the judge compares against: the logo / product / subject
 *  references (style references are only inspiration). */
function judgeReferences(input: GenerationBatchInput) {
  const roles = input.contract?.references ?? [];
  return input.referenceImages
    .map((img, i) => ({ ...img, role: roles[i]?.role ?? "style" }))
    .filter((r) => r.role !== "style");
}

/** Generate one placement through the quality gate: judge the image, and if
 *  it falls short make it once more with the fix, keeping the better one. */
async function generateChecked(input: GenerationBatchInput, placement: Placement) {
  const attempts: Attempt[] = [];
  const check = input.qualityCheck !== false;
  for (let i = 0; i < (check ? MAX_ATTEMPTS : 1); i++) {
    const last = attempts[attempts.length - 1];
    const fix = last?.quality ? fixFromReview(last.quality) : "";
    const prompt = !fix
      ? input.prompt
      : input.contract
        ? renderContract({ ...input.contract, fix })
        : `${input.prompt}\n\nFIX FROM REVIEW (most important this time): ${fix}`;
    const image = await generateImage(input.provider, { prompt, tier: input.tier, placement, referenceImages: input.referenceImages });
    const quality = check
      ? await judgeImage({
          image: { base64: image.imageBase64, mimeType: image.mimeType },
          brief: input.contract ? `${input.contract.frame} ${input.contract.scene}` : input.prompt,
          expectedText: input.expectedText ?? [],
          rules: input.qualityRules,
          references: judgeReferences(input),
        })
      : null;
    attempts.push({ image, quality });
    if (!quality || quality.passed) break;
  }
  const best = attempts.reduce((a, b) => ((b.quality?.score ?? -1) > (a.quality?.score ?? -1) ? b : a));
  return {
    best,
    attempts: attempts.length,
    // Every attempt was billed, not just the kept one.
    costUsd: attempts.reduce((sum, a) => sum + a.image.estCostUsd, 0),
  };
}

/** Fires one generation per placement in parallel, uploading + recording
 *  each result (or failure) as it completes. Shared by both generation
 *  entry points (brand-scoped and free-prompt) and their MCP equivalents —
 *  the only difference between callers is how `prompt`/`copy` get built. */
export async function runGenerationBatch(
  input: GenerationBatchInput
): Promise<{ batchId: string; results: Generation[] }> {
  if (input.delivery === "batch") return submitBatchGeneration(input);
  const batchId = crypto.randomUUID();

  const results = await Promise.all(
    input.placements.map(async (placement) => {
      try {
        const { best, attempts, costUsd } = await generateChecked(input, placement);
        const imageUrl = await uploadGeneratedImage(input.brandId, placement.id, best.image.imageBase64, best.image.mimeType);
        return insertGeneration({
          brand_id: input.brandId,
          batch_id: batchId,
          track: input.track,
          placement: placement.id,
          model_used: best.image.modelUsed,
          prompt_used: input.prompt,
          copy_label: input.copy?.label,
          copy_hook: input.copy?.hook,
          copy_cta: input.copy?.cta,
          image_url: imageUrl,
          est_cost_usd: costUsd,
          status: "complete",
          ...(best.quality ? { quality_score: best.quality.score, quality_notes: qualityNote(best.quality), quality_attempts: attempts } : {}),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return insertGeneration({
          brand_id: input.brandId,
          batch_id: batchId,
          track: input.track,
          placement: placement.id,
          prompt_used: input.prompt,
          status: "failed",
          error_message: message,
        });
      }
    })
  );

  return { batchId, results };
}
