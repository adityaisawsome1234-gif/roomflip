-- Exports (milestone 5): the shareable 9:16 reel and the square before/after
-- image made from a finished render.
--
-- One file per render, kind and variant. The variant is "free" (watermarked)
-- or "paid" (clean), so a user who upgrades gets a fresh clean export instead
-- of the watermarked one. Server access only: browsers get signed URLs.
create table public.exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  render_id uuid not null references public.renders (id) on delete cascade,
  kind text not null check (kind in ('reel', 'square')),
  variant text not null check (variant in ('free', 'paid')),
  -- Object path inside the private `exports` bucket.
  path text not null,
  bytes integer not null check (bytes > 0),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  duration_ms integer check (duration_ms is null or duration_ms > 0),
  created_at timestamptz not null default now(),
  constraint exports_render_kind_variant_key unique (render_id, kind, variant)
);

alter table public.exports enable row level security;

create index exports_user_created_idx on public.exports (user_id, created_at desc);
