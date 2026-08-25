import "server-only";
import type { Provider } from "./image-providers";
import type { Brand } from "./brands";

export type Copy = { label: string; hook: string; cta: string };

const SYSTEM_PROMPT =
  "You are an expert digital marketing copywriter. Convert the given brand and offer into a short, punchy visual hook for a graphic. Output strict JSON with exactly three keys: label (max 3 words, e.g. \"NEW ARRIVAL\"), hook (max 6 words, the main headline), cta (max 3 words, e.g. \"Shop Now\"). Keep it extremely concise — this text gets printed directly onto an image, so short is critical.";

function userPrompt(brand: Brand, offer: string) {
  return `Brand: ${brand.name}\nVoice/vibe: ${brand.voice_notes || "not specified"}\nOffer or message: ${offer}`;
}

async function copyViaGemini(brand: Brand, offer: string): Promise<Copy> {
  const apiKey = process.env.GOOGLE_AI_STUDIO_API_KEY || "";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n${userPrompt(brand, offer)}` }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );
  if (!res.ok) throw new Error(`Copywriting (Gemini) failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Copywriting (Gemini) returned no text.");
  return JSON.parse(text);
}

async function copyViaOpenAI(brand: Brand, offer: string): Promise<Copy> {
  const apiKey = process.env.OPENAI_API_KEY || "";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt(brand, offer) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`Copywriting (OpenAI) failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Copywriting (OpenAI) returned no text.");
  return JSON.parse(text);
}

/** Uses a cheap text model from the same provider as the chosen image
 *  model — avoids paying for a third vendor just for a few words of copy. */
export function generateCopy(provider: Provider, brand: Brand, offer: string): Promise<Copy> {
  return provider === "nano-banana" ? copyViaGemini(brand, offer) : copyViaOpenAI(brand, offer);
}
