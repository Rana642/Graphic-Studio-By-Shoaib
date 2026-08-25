@AGENTS.md

# Graphic Studio by Shoaib

Internal tool (not SaaS) for generating on-brand client graphics via AI image
APIs. Completely separate from the adsbyshoaib.com repo/Vercel/Supabase —
never share credentials or deploy targets between them.

**Branding is a deliberate continuation of adsbyshoaib.com's identity, not a
separate one** — same Cloud/Ink/Citrus/Cobalt tokens (`app/globals.css`),
same Instrument Serif + Geist pairing. Unlike the public marketing site's
8%/2% Citrus/Cobalt accent budget, this internal tool uses Citrus directly as
the primary action color (`--accent`/`--accent-foreground`), matching how
adsbyshoaib.com's own dashboard already treats its primary buttons — ink text
on citrus passes contrast, citrus text on cloud does not. If adsbyshoaib.com's
tokens ever change, update these to match.

**Read `docs/PLAN.md` first** — it's the full build plan: architecture,
two-track design (Creative vs. Asset-Locked), data model, and build order.
Follow its phase order; don't build Phase 3+ features before 1-2 are solid.

Key rules:
- Single/small-team internal tool: one service-role Supabase client
  (`lib/supabase/db.ts`) for all data access, gated by `proxy.ts`'s auth
  check — not per-table RLS. Invite-only auth, no public sign-up page.
- Asset-Locked track (real photos: property/product) must never let an AI
  model regenerate the actual photographed object — composite the real
  pixels in with `sharp`, AI only supplies the surrounding frame/background.
- Model calls live behind a shared interface in `lib/image-providers/` so
  Nano Banana Pro and GPT Image are interchangeable per-generation, not
  hardcoded to one vendor.
