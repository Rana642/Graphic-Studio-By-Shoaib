# Graphics Studio

Internal tool: pick a client brand, describe what's needed, get back on-brand,
multi-size, ready-to-post graphics. See `docs/PLAN.md` for the full build plan
and reasoning.

Deliberately separate from adsbyshoaib.com — its own repo, own Vercel project,
own Supabase project — so it never competes with that site's usage.

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

## Current status: Phase 1 (Foundation)

- [x] Auth-gated shell (everything requires login except `/login`)
- [x] Brand Vault — create/edit/delete brand kits (logo, colors, font, voice)
- [ ] Phase 2 — Creative Track: multi-size AI generation (Nano Banana Pro /
      GPT Image), copy generation, results gallery
- [ ] Phase 3 — Asset-Locked Track: real photo compositing for real estate/
      product work
- [ ] Phase 4 — Rare identity assets (mood board, business card, letterhead)
- [ ] Deferred — print/billboard upscaling, auto-posting to Meta/LinkedIn

## Stack

Next.js (App Router) + TypeScript + Tailwind CSS v4 + Supabase (Postgres +
Storage + Auth), same conventions as adsbyshoaib.com's dashboard: a
service-role client (`lib/supabase/db.ts`) does all data access, gated by
`proxy.ts`'s auth check rather than per-table RLS policies — appropriate for
a single/small-team internal tool, not a multi-tenant product.
