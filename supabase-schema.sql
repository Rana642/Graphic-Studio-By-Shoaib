-- Graphics Studio schema. Run once in the new Supabase project's SQL Editor.
-- RLS is intentionally left off both tables (default deny for the anon key)
-- — all access goes through the service-role client in lib/supabase/db.ts,
-- gated by proxy.ts's auth check, same pattern as adsbyshoaib.com's
-- business dashboard.

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
  created_at timestamptz not null default now()
);

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

-- Storage buckets (create these in the Storage tab if the SQL editor's
-- storage.buckets insert is blocked by your project's policies):
-- - "logos"       — brand logo uploads
-- - "generations" — generated/composited output images
