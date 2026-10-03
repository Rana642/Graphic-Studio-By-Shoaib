import "server-only";

/**
 * Vision Quality Gate (2026-10-03) — after every AI image, a vision model
 * checks it against the brief and, if it falls short, the image is made once
 * more with a fix hint and the better of the two is kept. Pattern from the
 * MIT-licensed "AI Content Factory" (coleam00/ai-content-factory, forked to
 * Rana642): score → regenerate weak frames with a cleanup hint → keep best.
 *
 * Judge: OpenAI gpt-5.4-mini (picked over gpt-4.1-mini in a side-by-side on
 * real Tad Pharma posts: it caught a "Gut"→"Liver" headline swap and a dark
 * panel, and did not fail correct images). Override with QUALITY_MODEL. The
 * gate never blocks: with no key or on any error it returns null and the
 * image is kept as is.
 */

export type QualityResult = {
  score: number;
  /** Every expected line present and spelled right. */
  textOk: boolean;
  passed: boolean;
  wrongText: string[];
  extraText: string[];
  issues: string[];
  fixHint: string;
  judge: string;
};

/** Below this, or with wrong text, an image is retried once. */
export const QUALITY_PASS_SCORE = 70;

const MODEL = process.env.QUALITY_MODEL || "gpt-5.4-mini";

const SYSTEM = `You are a strict quality reviewer for brand marketing graphics. Compare the IMAGE with the BRIEF and answer ONLY with JSON:
{"score": <0-100 overall quality>, "text_ok": <true if every EXPECTED TEXT line appears in the image spelled exactly — case and line wrapping may differ>,
"wrong_text": [<expected lines that are missing, misspelled or garbled>],
"extra_text": [<readable words in the design that are NOT in the expected text — ignore words printed on a product's own pack or label and inside a logo>],
"issues": [<up to 5 short, concrete problems>],
"fix_hint": "<one short instruction to the image model that would fix the biggest problems — it must keep the RULES and everything that is already right, never contradict them>"}
Score guide: 90+ flawless and premium; 70-89 good with small issues; 50-69 visible problems; below 50 broken (garbled text, wrong words, warped product or logo, cluttered).
Hard caps: wrong or garbled expected text → at most 55. Invented extra text → at most 65. A logo or product that clearly differs from its reference image → at most 60. Words printed on a product's own label must match its reference photo letter by letter — a misspelled or garbled label word (e.g. "VETTRINARY" for "VETERINARY") is a product mismatch: list it in issues and cap at 60. Judge label WORDS only — punctuation, commas, line breaks, letter case, font and small layout differences on the label are not mismatches and must not lower the score. When RULES say no dark colours, a large dark or black background, panel or band → at most 60.
If there is no expected text, judge only quality, faithfulness to the brief and the rules; any readable invented text is then an issue.`;

type Img = { base64: string; mimeType: string };

export async function judgeImage(input: {
  image: Img;
  brief: string;
  expectedText: string[];
  rules?: string;
  /** Logo / product / subject images to compare against (max 2 used). */
  references?: (Img & { role: string })[];
}): Promise<QualityResult | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const refs = (input.references ?? []).slice(0, 2);
  const brief = [
    `BRIEF: ${input.brief.slice(0, 1500)}`,
    input.expectedText.length
      ? `EXPECTED TEXT (each line must appear exactly):\n${input.expectedText.map((t) => `- ${t}`).join("\n")}`
      : "EXPECTED TEXT: none — the image should carry no invented words.",
    `RULES: ${input.rules || "none"}`,
    refs.length ? `After the main image come ${refs.length} reference image(s): ${refs.map((r, i) => `ref ${i + 1} = ${r.role}`).join(", ")}. Check the main image keeps them faithful.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const body: Record<string, unknown> = {
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: brief },
            { type: "image_url", image_url: { url: `data:${input.image.mimeType};base64,${input.image.base64}`, detail: "high" } },
            // High detail: the reviewer reads the real label to catch misspelled pack text.
            ...refs.map((r) => ({ type: "image_url", image_url: { url: `data:${r.mimeType};base64,${r.base64}`, detail: "high" } })),
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1500,
    };
    if (/^gpt-5/.test(MODEL)) body.reasoning_effort = "low";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const out = JSON.parse(json?.choices?.[0]?.message?.content ?? "{}");
    const score = Math.max(0, Math.min(100, Math.round(Number(out.score) || 0)));
    const textOk = input.expectedText.length === 0 ? true : Boolean(out.text_ok);
    return {
      score,
      textOk,
      passed: score >= QUALITY_PASS_SCORE && textOk,
      wrongText: Array.isArray(out.wrong_text) ? out.wrong_text.map(String) : [],
      extraText: Array.isArray(out.extra_text) ? out.extra_text.map(String) : [],
      issues: Array.isArray(out.issues) ? out.issues.map(String).slice(0, 5) : [],
      fixHint: String(out.fix_hint ?? ""),
      judge: MODEL,
    };
  } catch {
    return null;
  }
}

/** The correction a retry carries in its prompt (FIX FROM REVIEW block). */
export function fixFromReview(q: QualityResult): string {
  const parts = [
    q.wrongText.length ? `These words must appear exactly as written: ${q.wrongText.map((t) => `"${t}"`).join(", ")}.` : "",
    q.extraText.length ? `Remove these invented words: ${q.extraText.slice(0, 6).map((t) => `"${t}"`).join(", ")}.` : "",
    q.fixHint,
    q.issues.length ? `Problems seen: ${q.issues.join("; ")}.` : "",
    // A fix must never trade one rule for another (a retry once went dark while
    // chasing a "glass cards" hint).
    "Keep everything that was already right, the exact text, the brand palette and every rule above — especially a light, bright background, never dark.",
  ];
  return parts.filter(Boolean).join(" ");
}

/** Short human summary stored on the generation row. */
export function qualityNote(q: QualityResult): string {
  const bits = [
    !q.textOk && q.wrongText.length ? `Text: ${q.wrongText.join(" | ")}` : "",
    ...q.issues,
  ].filter(Boolean);
  return bits.join(" • ").slice(0, 600);
}
