-- RoomFlip core schema (milestone 1): profiles, paint catalog, rooms, renders, storage buckets.
--
-- Access model
--   * Row level security is on for every table.
--   * Client roles (anon, authenticated) can reach nothing in `public` unless this
--     file grants it explicitly. Grants are column-level where a table holds
--     internal fields (prompts, provider ids, costs, storage paths).
--   * All writes to rooms and renders go through server code using the service
--     role, so there are no client insert/update/delete grants or policies.
--   * Storage buckets are private and have no client policies: the server hands
--     out short-lived signed URLs after checking ownership and entitlement.

-- ---------------------------------------------------------------------------
-- Default privileges: new objects in public are closed to client roles.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, created by trigger.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'App-side mirror of auth.users. Created by the on_auth_user_created trigger.';

alter table public.profiles enable row level security;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

create policy "profiles: owner can read"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "profiles: owner can update"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Create the profile when a user signs up. Metadata comes from the identity
-- provider (or from the client for email sign-ups), so it is trimmed and
-- length-limited rather than trusted.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_avatar text;
begin
  v_name := nullif(
    left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), 80),
    ''
  );
  v_avatar := new.raw_user_meta_data ->> 'avatar_url';
  if v_avatar is null or char_length(v_avatar) > 2048 or v_avatar !~* '^https://' then
    v_avatar := null;
  end if;

  insert into public.profiles (id, email, display_name, avatar_url)
  values (new.id, new.email, v_name, v_avatar)
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep the mirrored email in step when the user changes it.
create function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

revoke all on function public.handle_user_email_change() from public, anon, authenticated;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- paint_colors: public reference catalog (rows are loaded by a later migration).
-- ---------------------------------------------------------------------------
create table public.paint_colors (
  id bigint generated always as identity primary key,
  brand text not null check (brand in ('benjamin_moore', 'sherwin_williams')),
  name text not null check (char_length(name) between 1 and 80),
  code text not null check (char_length(code) between 1 and 20),
  hex text not null check (hex ~ '^#[0-9A-F]{6}$'),
  family text not null check (
    family in (
      'white', 'off_white', 'gray', 'greige', 'beige', 'brown', 'black',
      'blue', 'green', 'yellow', 'orange', 'red', 'pink', 'purple'
    )
  ),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint paint_colors_brand_code_key unique (brand, code)
);

comment on table public.paint_colors is 'Popular Benjamin Moore and Sherwin-Williams colors. Hex values are on-screen approximations.';

alter table public.paint_colors enable row level security;

create index paint_colors_browse_idx on public.paint_colors (brand, family, sort_order);

grant select on public.paint_colors to anon, authenticated;

create policy "paint_colors: anyone can read active colors"
  on public.paint_colors for select to anon, authenticated
  using (is_active);

-- ---------------------------------------------------------------------------
-- rooms: an uploaded photo of a room (already EXIF-stripped and moderated).
-- ---------------------------------------------------------------------------
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text check (title is null or char_length(title) between 1 and 80),
  -- Free-form label used in captions, e.g. "living room".
  room_type text check (room_type is null or char_length(room_type) between 1 and 40),
  -- Object path inside the private `originals` bucket.
  original_path text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  bytes integer not null check (bytes > 0),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.rooms enable row level security;

create index rooms_user_created_idx on public.rooms (user_id, created_at desc) where deleted_at is null;

grant select (id, user_id, title, room_type, width, height, created_at) on public.rooms to authenticated;

create policy "rooms: owner can read"
  on public.rooms for select to authenticated
  using ((select auth.uid()) = user_id and deleted_at is null);

-- ---------------------------------------------------------------------------
-- renders: one generation job. A preview and its HD final are separate rows.
-- ---------------------------------------------------------------------------
create table public.renders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  -- For an HD final: the preview it was made from. Null for previews and regenerations.
  source_render_id uuid references public.renders (id) on delete set null,
  tier text not null check (tier in ('preview', 'hd')),
  mode text not null check (mode in ('style', 'paint', 'material')),
  -- Mode-specific inputs, validated by the server before insert:
  --   style:    {"preset": "japandi"} or {"custom": "warm minimalist with oak"}
  --   paint:    {"paint_color_id": 12, "surfaces": ["walls"]}
  --   material: {"swatch_path": "<object path>", "target": "sofa"}
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  prompt text not null,
  provider text not null,
  model text not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'succeeded', 'failed')),
  attempts smallint not null default 0 check (attempts >= 0),
  provider_request_id text,
  error_code text,
  error_message text,
  -- Clean master in the private `renders` bucket, and the watermarked copy served to free users.
  result_path text,
  watermarked_path text,
  result_width integer check (result_width is null or result_width > 0),
  result_height integer check (result_height is null or result_height > 0),
  credits_charged integer not null default 0 check (credits_charged >= 0),
  -- Provider price for this render at the time it ran, for cost-per-render reporting.
  cost_usd numeric(10, 4) check (cost_usd is null or cost_usd >= 0),
  is_saved boolean not null default false,
  -- A job still queued or processing after this instant is failed and refunded.
  deadline_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renders_succeeded_has_result check (status <> 'succeeded' or result_path is not null),
  constraint renders_hd_has_source check (tier = 'hd' or source_render_id is null)
);

alter table public.renders enable row level security;

create trigger renders_set_updated_at
  before update on public.renders
  for each row execute function public.set_updated_at();

create index renders_user_created_idx on public.renders (user_id, created_at desc);
create index renders_room_created_idx on public.renders (room_id, created_at desc);
create index renders_saved_idx on public.renders (user_id, created_at desc) where is_saved;
create index renders_source_idx on public.renders (source_render_id) where source_render_id is not null;
-- The sweeper looks for in-flight jobs past their deadline.
create index renders_in_flight_idx on public.renders (deadline_at) where status in ('queued', 'processing');
-- Webhook lookups, and a guard against two rows claiming the same provider job.
create unique index renders_provider_request_key
  on public.renders (provider, provider_request_id)
  where provider_request_id is not null;

-- Clients see job state and dimensions, never prompts, provider ids, costs or storage paths.
grant select (
  id, user_id, room_id, source_render_id, tier, mode, params, status, error_code,
  result_width, result_height, credits_charged, is_saved, created_at, started_at, completed_at
) on public.renders to authenticated;

create policy "renders: owner can read"
  on public.renders for select to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Storage: private buckets, server access only.
-- Object paths start with the owning user's id: `<user_id>/<object>`.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('originals', 'originals', false, 15728640, array['image/jpeg', 'image/png', 'image/webp']),
  ('swatches', 'swatches', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('renders', 'renders', false, 26214400, array['image/jpeg', 'image/png', 'image/webp']),
  ('exports', 'exports', false, 104857600, array['video/mp4', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
