# Internal Brand Graphics Studio — Build Plan

## Context

Shoaib wants an internal tool (not a SaaS product) that replaces hiring a graphic
designer + copywriter for his own client work: pick a client brand, describe what's
needed, get back on-brand, multi-size, ready-to-post graphics with correctly
spelled labels/CTAs — without a human designer in the loop, and without the
brand drifting between generations the way raw AI image prompts usually do.

He did his own research (pasted a long Google AI Mode conversation) landing on
Next.js + Nano Banana Pro / GPT Image APIs + Supabase, deployed completely
separately from adsbyshoaib.com (own Vercel account, own Supabase project) so it
never competes with the main site's usage. Clarified via follow-up questions:
- **Full Next.js web app**, not a Claude-Code-only skill — he wants a real
  brand-switcher UI where selecting a brand scopes every generation to that
  brand's identity, usable outside a Claude Code session.
- **Both models** — Nano Banana Pro (Gemini) and GPT Image (OpenAI), latest
  versions of each, selectable per generation.
- Cost is not a concern (pay-as-you-go APIs, no fixed hosting cost either way).
- **Design for future auto-posting** (Meta/LinkedIn publishing) without building
  it now — the data model should make that a later addition, not a rework.
- He separately raised the real concern that AI-regenerating an uploaded real
  property/product photo would visibly alter it — needs a way to keep the real
  photo pixel-perfect while AI supplies everything else.

Found while planning: `E:\Rana Shoaib\My Projects Website\` already has several
of his real client project folders (Hotel Elegant Multan, Hotel Silver Sand
Multan, Meezab Z, tad-pharma, plus a loose `log png & svg` folder with a few
logo files) — confirms these are real clients matching his resume/case-study
data, and confirms there's no existing organized "brand kit" asset system yet;
this app's Brand Vault is genuinely new, not a rebuild of something.

## Two-Track Design (the key improvement over the pasted research)

The source research kept hoping the AI model itself would "leave a safe zone"
for real photos and "not misspell text" — both are still probabilistic even
with careful prompting. Splitting into two tracks removes that risk entirely
for the cases where it matters most:

- **Creative Track** (regular social posts, mood boards, no specific real
  object to preserve): full AI generation via Nano Banana Pro / GPT Image.
  Hallucination risk here is cosmetic, not a trust problem.
- **Asset-Locked Track** (real estate, product photos, anything where the
  actual photographed object must not change): AI generates *only* a
  background/frame template with a fixed, known empty rectangle. The real
  photo is then composited into that exact rectangle with the `sharp` npm
  library — a deterministic crop/resize, not a regeneration — and all text
  (labels, CTAs, agent name, price) is rendered as crisp vector text via
  `sharp`'s SVG-overlay support, not AI-drawn. This guarantees the photo is
  byte-identical to the upload and every word is spelled exactly as typed,
  at the cost of the layout being template-based rather than infinitely
  freeform for this track specifically.

## Tech Stack

- Next.js (App Router) + TypeScript + Tailwind CSS v4 — same stack he already
  knows from adsbyshoaib.com, no new learning curve
- Supabase (own new project): Postgres for brand kits + generation history,
  Storage for logos and generated images, simple email/password Auth
  (invite-only, not public signup — just him/small team)
- `sharp` for the Asset-Locked compositing pipeline (deterministic, no AI)
- New GitHub repo + new Vercel project, deployed under a separate Vercel
  account — completely isolated from adsbyshoaib.com's usage
- No Sanity here — this is operational data (brand kits, generation jobs), not
  marketing content; matches the same reasoning that already keeps the
  Supabase business dashboard separate from Sanity on the main site

## Data Model (Supabase)

- **brands** — id, name, logo_url, primary_hex, secondary_hex, accent_hex,
  font_family, voice_notes, created_at
- **generations** — id, brand_id (FK), batch_id (groups a multi-size click),
  track ("creative" | "asset_locked"), placement (ig_feed, ig_story, meta_ad,
  linkedin_cover, fb_cover, youtube_cover, business_card, letterhead,
  moodboard, custom), model_used, prompt_used, copy_label/hook/cta,
  image_url, est_cost, status, created_at

Designing `generations` with `placement` + `image_url` + generated copy from
day one means a future "publish" feature just reads rows with
`status = 'complete'` — no schema rework later. Social account tokens /
scheduling would be new tables added on top, not a migration of this one.

## Model & Copy Abstraction

- `lib/image-providers/{nanoBanana,gptImage}.ts` implementing one shared
  interface: `generate({ prompt, width, height }) -> { url }`
- Copywriting (short label/hook/CTA) uses a cheap text model from the *same*
  provider as the selected image model (Gemini Flash alongside Nano Banana
  Pro, a small GPT model alongside GPT Image) — avoids adding a third vendor
  API just for a few words of text. Anthropic/Claude API is a fine upgrade
  later if he wants that voice specifically, but isn't needed for v1.
- A `PLACEMENT_SPECS` table in code holds exact dimensions + safe-zone rules
  per platform (IG feed 1080x1350, Stories 1080x1920, LinkedIn cover
  1584x396, etc.) — one click fires `Promise.all` across every requested
  placement in parallel.

## Build Order

1. **Foundation** — repo scaffold, Supabase project + schema + Storage
   buckets, invite-only auth, Brand Vault CRUD (create/edit a brand: logo
   upload, hex colors, font, voice).
2. **Creative Track (core value)** — placement specs, dual model providers,
   copy step, `/api/generate` parallel multi-size pipeline, results gallery
   with download.
3. **Asset-Locked Track** — photo upload, `sharp` compositing + SVG text
   overlay, for real estate/product work.
4. **Rare Identity assets** — mood board, company profile, business card,
   letterhead (template-driven, mixing AI backgrounds with `sharp`-placed
   logo/text for precision).
5. **Deferred, not built now**: print/billboard upscaling (Fal.ai/Replicate),
   auto-posting to Meta/LinkedIn — schema already supports both being added
   later without rework.

## Verification

- End-to-end test with one real brand: generate all 3 regular-track sizes,
  confirm hex colors match input and label/CTA text is correctly spelled.
- Asset-Locked test: upload a real photo, confirm the output crop is
  byte-identical to the source (not AI-touched) and overlay text is crisp.
- Deploy to Vercel preview and confirm Supabase env vars work in production
  before pointing a real domain/subdomain at it.

## Open items (decide at build/deploy time, don't block starting)

- Domain/subdomain choice (e.g. `studio.adsbyshoaib.com` vs a separate
  domain) — DNS-level, doesn't affect the code.
- Whether the Anthropic/Claude API gets added later for copywriting quality.
