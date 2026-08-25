-- Graphics Studio schema. Run once in the new Supabase project's SQL Editor.
-- RLS is enabled with NO policies on both tables — this is default-deny for
-- the anon/authenticated keys (which ship in the browser bundle), while the
-- service-role client in lib/supabase/db.ts bypasses RLS entirely and does
-- all real data access, gated by proxy.ts's auth check. Same pattern as
-- adsbyshoaib.com's business dashboard. Do NOT add anon/authenticated
-- policies later without a real reason — the app was built assuming the
-- anon key can reach nothing.

create extension if not exists "pgcrypto";

create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text,
  primary_hex text not null default '#111111',
  secondary_hex text,
  accent_hex text,
  font_family text,
  voice_notes text,
  -- Full brand context (2026-08-25) — what the brand does, its services,
  -- and its real contact/social details. Feeds copywriting (fuller context
  -- than voice_notes alone) and gets appended as a footer line on generated
  -- graphics when present. Also the groundwork for a future social-media
  -- content calendar (brand awareness / product / event posts, etc.) —
  -- that calendar isn't built yet, but needs this data to exist first.
  about text,
  services text,
  contact_phone text,
  contact_email text,
  website_url text,
  instagram_handle text,
  facebook_handle text,
  linkedin_handle text,
  tiktok_handle text,
  created_at timestamptz not null default now()
);

-- Safe to run against an already-existing brands table (create table above
-- is only for a fresh setup and won't add columns to one that already
-- exists) — this is the actual migration Shoaib needs to run.
alter table brands add column if not exists about text;
alter table brands add column if not exists services text;
alter table brands add column if not exists contact_phone text;
alter table brands add column if not exists contact_email text;
alter table brands add column if not exists website_url text;
alter table brands add column if not exists instagram_handle text;
alter table brands add column if not exists facebook_handle text;
alter table brands add column if not exists linkedin_handle text;
alter table brands add column if not exists tiktok_handle text;

create type generation_track as enum ('creative', 'asset_locked');

create type generation_status as enum ('pending', 'complete', 'failed');

create table if not exists generations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  batch_id uuid not null default gen_random_uuid(),
  track generation_track not null default 'creative',
  placement text not null,
  model_used text,
  prompt_used text,
  copy_label text,
  copy_hook text,
  copy_cta text,
  image_url text,
  est_cost_usd numeric(10, 4),
  status generation_status not null default 'pending',
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists generations_brand_id_idx on generations(brand_id);
create index if not exists generations_batch_id_idx on generations(batch_id);

-- Existing client posts/graphics uploaded per brand, so new generations can
-- be conditioned on them for style consistency (see lib/image-providers/).
create table if not exists brand_references (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  image_url text not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists brand_references_brand_id_idx on brand_references(brand_id);

alter table brands enable row level security;
alter table generations enable row level security;
alter table brand_references enable row level security;

-- Storage buckets (create these in the Storage tab if the SQL editor's
-- storage.buckets insert is blocked by your project's policies):
-- - "logos"       — brand logo uploads AND reference images (path:
--                    {brandId}/references/... for the latter)
-- - "generations" — generated/composited output images
