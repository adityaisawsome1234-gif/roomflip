-- Render pipeline (milestone 3): swatch uploads, moderation outcome, and the
-- fields the background job runner needs.

-- ---------------------------------------------------------------------------
-- Moderation outcome on uploads.
--   passed   the image was checked and allowed
--   skipped  no moderation provider was configured (local development only;
--            production refuses uploads instead of skipping)
-- Flagged images are never stored, so there is no "flagged" value.
-- ---------------------------------------------------------------------------
alter table public.rooms
  add column moderation text not null default 'passed' check (moderation in ('passed', 'skipped'));

-- ---------------------------------------------------------------------------
-- swatches: a photo of a fabric, tile or flooring sample for material mode.
-- Material renders reference a swatch by id, never by storage path, so one
-- user cannot point a render at another user's file.
-- ---------------------------------------------------------------------------
create table public.swatches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Object path inside the private `swatches` bucket.
  path text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  bytes integer not null check (bytes > 0),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  moderation text not null default 'passed' check (moderation in ('passed', 'skipped')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.swatches enable row level security;

create index swatches_user_created_idx on public.swatches (user_id, created_at desc)
  where deleted_at is null;

grant select (id, user_id, width, height, created_at) on public.swatches to authenticated;

create policy "swatches: owner can read"
  on public.swatches for select to authenticated
  using ((select auth.uid()) = user_id and deleted_at is null);

-- ---------------------------------------------------------------------------
-- renders: what the job runner records about the provider request.
-- ---------------------------------------------------------------------------
alter table public.renders
  -- The provider endpoint the job was sent to. Stored because the model config
  -- can change while a job is in flight, and status lookups must hit the same endpoint.
  add column provider_endpoint text,
  -- When the job runner last asked the provider about this job. Throttles
  -- status polling when webhooks are missing (local development, outages).
  add column last_checked_at timestamptz,
  -- What the provider was sent besides the prompt: the input images (bucket and
  -- path, in prompt order) and the output size. Kept so a failed attempt can be
  -- resubmitted. Not visible to clients.
  add column job_input jsonb check (job_input is null or jsonb_typeof(job_input) = 'object');

-- Hand a queued render to the provider. Only a render still in flight can be
-- marked, so a render that already failed (and was refunded) is never revived.
create function public.mark_render_submitted(
  p_render_id uuid,
  p_provider_request_id text,
  p_provider_endpoint text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.renders
  set status = 'processing',
      provider_request_id = p_provider_request_id,
      provider_endpoint = p_provider_endpoint,
      attempts = attempts + 1,
      started_at = coalesce(started_at, now()),
      last_checked_at = now()
  where id = p_render_id
    and status in ('queued', 'processing');
  return found;
end;
$$;

revoke all on function public.mark_render_submitted(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_render_submitted(uuid, text, text) to service_role;
