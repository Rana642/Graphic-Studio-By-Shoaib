# Graphic Studio by Shoaib

Internal tool: pick a client brand, describe what's needed, get back on-brand,
multi-size, ready-to-post graphics. See `docs/PLAN.md` for the full build plan
and reasoning.

Deliberately separate from adsbyshoaib.com — its own repo, own Vercel project,
own Supabase project — so it never competes with that site's usage. Branding
(Cloud/Ink/Citrus/Cobalt, Instrument Serif + Geist) carries over from
adsbyshoaib.com on purpose — this is a continuation of that identity, not a
separate one.

## Setup

1. **Create a new Supabase project** (separate from adsbyshoaib.com's).
2. In the SQL Editor, run `supabase-schema.sql`.
3. In Storage, create two buckets: `logos` and `generations` (public read is
   fine for both — these are marketing assets, not sensitive data).
4. Copy `.env.local.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Project
     Settings → API
   - `SUPABASE_SERVICE_ROLE_KEY` — same page, "service_role" secret
5. **Create your login user**: Supabase dashboard → Authentication → Users →
   Add user (email + password). This app has no public sign-up page on
   purpose — invite-only.
6. `npm run dev` and sign in at `/login`.

## Current status

- [x] Phase 1 — Auth-gated shell, Brand Vault (create/edit/delete brand kits)
- [x] Phase 2 — Creative Track: multi-size AI generation (Nano Banana Pro /
      GPT Image, draft/standard/premium tiers), copywriting, results gallery.
      Pipeline verified end-to-end against real API keys; actual image output
      still untested pending billing credits on both provider accounts.
- [x] Free-prompt generation — `/generate`, no brand required, optional
      ad-hoc reference images, optional brand tag for filing/history only.
- [x] Enhance/upscale — "Enhance" button on any completed generation
      (Topaz Standard V2/High Fidelity V2/Text Refine/CGI/Low Resolution
      V2, 2x/4x/6x). Needs `TOPAZ_API_KEY` in `.env.local`. More upscale
      providers may be added later (Replicate's Crystal is the next
      candidate — better $/quality for real-photo fidelity per research).
- [x] Subject-Preserving Edit — `/generate/subject`, upload a real photo
      (person or product), describe a new background/scene; the subject
      stays visually unchanged (near-perfect, AI edit not deterministic
      compositing). Right fit when something *real* must not be redrawn but
      full creative freedom is fine for everything around it (salon
      results, product shots).
- [x] Asset-Locked Track — `/generate/asset-locked`, 100% pixel-perfect:
      the whole photo/3D-render composited via `sharp` + `@resvg/resvg-js`
      (Urdu Nastaliq-capable, no fontconfig dependency) into a hand-designed
      template, never touched by AI — no AI call at all for this track,
      free. Two templates so far (`lib/asset-locked/templates/`): a real
      estate poster (Urdu headline + feature banners) and a full-bleed event
      overlay (gradient band + logo badge). Add more templates by adding a
      file there, same pattern.
- [x] Auto-retouch (`lib/retouch.ts`) — deterministic exposure/contrast
      correction (fixes dark/underexposed photos) applied to every real
      photo before it enters Subject-Preserving Edit or Asset-Locked — the
      "Photoshop does levels before creative work" step. Pixel-value-only,
      so it can't alter a face's shape; the AI still never touches faces
      either (see `buildSubjectEditPrompt`).
- [ ] Phase 4 — Rare identity assets (mood board, business card, letterhead)
- [ ] Deferred — auto-posting to Meta/LinkedIn

## Stack

Next.js (App Router) + TypeScript + Tailwind CSS v4 + Supabase (Postgres +
Storage + Auth), same conventions as adsbyshoaib.com's dashboard: a
service-role client (`lib/supabase/db.ts`) does all data access, gated by
`proxy.ts`'s auth check rather than per-table RLS policies — appropriate for
a single/small-team internal tool, not a multi-tenant product.

## MCP server (for Claude Code)

`mcp/` is a local MCP server that lets Claude Code manage brands and trigger
graphic generation directly — no browser needed. It reuses the same `lib/`
business logic as the web app (Supabase service-role client, image
providers, placement specs, prompt builder), skipping only the Next.js-only
glue (cookie auth, server actions, revalidation) that doesn't apply outside
an HTTP request.

**Tools**: `studio_list_brands`, `studio_get_brand`, `studio_create_brand`,
`studio_update_brand`, `studio_list_placements`, `studio_generate_graphics`,
`studio_generate_from_prompt`, `studio_generate_subject_edit`,
`studio_list_asset_locked_templates`, `studio_generate_asset_locked`,
`studio_list_generations`, `studio_enhance_generation`.

New app features get a matching MCP tool added in the same pass — the web
app and the MCP server should never drift apart in capability.

**Requires**: `.env.local` filled in (Supabase + at least one of
`GOOGLE_AI_STUDIO_API_KEY` / `OPENAI_API_KEY`) — same file the web app uses.

Run it directly (for local testing):

```bash
npm run mcp
```

Register it with Claude Code so it's available from any project (useful
since the point of `studio_list_generations` is pulling finished graphics
into *other* projects' `public/images`):

```bash
claude mcp add graphics-studio --scope user -- "E:/Rana Shoaib/My Projects Website/graphics-studio/node_modules/.bin/tsx.cmd" --conditions=react-server "E:/Rana Shoaib/My Projects Website/graphics-studio/mcp/index.ts"
```

Run that once from any terminal (not `npm run` — it needs the plain
`claude` CLI). `--scope user` makes it available in every Claude Code
session on this machine, not just inside this repo. The server reads
`.env.local` itself, resolved relative to its own file, so it works
regardless of which directory Claude Code launches it from.

The `--conditions=react-server` flag matters: `lib/` files are marked
`import "server-only"` for the Next.js build, and that package throws
unconditionally under plain Node unless the `react-server` export
condition is set (Next.js sets it internally; a standalone Node process
has to be told).
