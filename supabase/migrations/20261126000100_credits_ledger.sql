-- RoomFlip credits ledger (milestone 2).
--
-- Credits are never stored as a balance. Every change is one immutable row in
-- credit_ledger, and a balance is always the sum of a user's rows.
--
-- Buckets
--   Each row belongs to a bucket, because the three kinds of credit behave
--   differently:
--     subscription  granted by a plan; unused ones expire at the next grant
--     free          the signup grant; never expires
--     pack          bought one-off; never expires
--   Renders spend subscription credits first (they expire), then free, then
--   pack. Expiry is an explicit negative row written when the next grant
--   arrives, so "balance = sum(amount)" holds at all times with no clock maths.
--
-- Concurrency
--   Every function that changes a user's credits first takes a row lock on that
--   user's profile. That makes credit changes for one user strictly serial, so
--   a balance check and the debit that follows it cannot interleave with
--   another spend. Lock order is always profile, then render.
--
-- Access
--   credit_ledger can only be written through the functions below. They are
--   SECURITY DEFINER, executable by the service role only. The service role can
--   read the table but cannot insert, update or delete rows directly, and an
--   UPDATE is refused for every role by a trigger.
--
-- Errors
--   Business-rule failures raise SQLSTATE codes in the custom class RF so the
--   server can tell them apart:
--     RF400 invalid argument        RF404 user, room or render not found
--     RF402 insufficient credits    RF409 conflicting or invalid state

-- ---------------------------------------------------------------------------
-- renders: a client-supplied id per tap, so a double tap is one job, not two.
-- ---------------------------------------------------------------------------
alter table public.renders add column client_request_id uuid;

create unique index renders_client_request_key
  on public.renders (user_id, client_request_id)
  where client_request_id is not null;

-- ---------------------------------------------------------------------------
-- credit_ledger
-- ---------------------------------------------------------------------------
create table public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Positive adds credits, negative removes them. Never zero.
  amount integer not null check (amount <> 0),
  bucket text not null check (bucket in ('subscription', 'free', 'pack')),
  kind text not null check (
    kind in (
      'signup_grant', 'subscription_grant', 'pack_purchase',
      'render_debit', 'render_refund', 'expiry', 'reversal', 'adjustment'
    )
  ),
  -- The render a debit or refund belongs to. Deliberately not a foreign key:
  -- ledger rows outlive the renders they paid for.
  render_id uuid,
  -- Makes every write replay-safe: the same key can only ever produce one row.
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  constraint credit_ledger_idempotency_key_key unique (idempotency_key),
  constraint credit_ledger_amount_sign check (
    (kind in ('signup_grant', 'subscription_grant', 'pack_purchase', 'render_refund') and amount > 0)
    or (kind in ('render_debit', 'expiry', 'reversal') and amount < 0)
    or kind = 'adjustment'
  ),
  constraint credit_ledger_render_kinds_have_render check (
    kind not in ('render_debit', 'render_refund') or render_id is not null
  )
);

comment on table public.credit_ledger is
  'Append-only record of every credit change. A balance is sum(amount). Written only through the credit functions.';

alter table public.credit_ledger enable row level security;

create index credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);
create index credit_ledger_render_idx on public.credit_ledger (render_id) where render_id is not null;

-- The service role may read the ledger and nothing else. No client role may touch it.
revoke all on public.credit_ledger from anon, authenticated, service_role;
grant select on public.credit_ledger to service_role;

create function public.credit_ledger_block_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'RF409', message = 'credit_ledger_is_append_only';
end;
$$;

revoke all on function public.credit_ledger_block_update() from public, anon, authenticated;

create trigger credit_ledger_no_update
  before update on public.credit_ledger
  for each row execute function public.credit_ledger_block_update();

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by any API role)
-- ---------------------------------------------------------------------------

-- Take the per-user lock that serialises credit changes. Raises if the user is gone.
create function public.credits_lock_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    raise exception using errcode = 'RF404', message = 'user_not_found';
  end if;
end;
$$;

revoke all on function public.credits_lock_user(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reading balances
-- ---------------------------------------------------------------------------
create function public.credit_balances(p_user_id uuid)
returns table (total integer, subscription integer, free integer, pack integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(l.amount), 0)::integer,
    coalesce(sum(l.amount) filter (where l.bucket = 'subscription'), 0)::integer,
    coalesce(sum(l.amount) filter (where l.bucket = 'free'), 0)::integer,
    coalesce(sum(l.amount) filter (where l.bucket = 'pack'), 0)::integer
  from public.credit_ledger l
  where l.user_id = p_user_id;
$$;

revoke all on function public.credit_balances(uuid) from public, anon, authenticated;
grant execute on function public.credit_balances(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Granting
-- ---------------------------------------------------------------------------

-- Add credits. Returns true when this call created the grant and false when
-- the idempotency key had already been used for the same grant (a replay).
--
-- p_reset_bucket implements "no rollover": whatever is left in the bucket is
-- written off with an expiry row before the new credits are added.
create function public.grant_credits(
  p_user_id uuid,
  p_amount integer,
  p_kind text,
  p_bucket text,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb,
  p_reset_bucket boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.credit_ledger%rowtype;
  v_remaining integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception using errcode = 'RF400', message = 'invalid_amount';
  end if;
  if p_kind is null or p_kind not in ('signup_grant', 'subscription_grant', 'pack_purchase', 'adjustment') then
    raise exception using errcode = 'RF400', message = 'invalid_kind';
  end if;
  if p_bucket is null or p_bucket not in ('subscription', 'free', 'pack') then
    raise exception using errcode = 'RF400', message = 'invalid_bucket';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 180 then
    raise exception using errcode = 'RF400', message = 'invalid_idempotency_key';
  end if;

  perform public.credits_lock_user(p_user_id);

  select * into v_existing from public.credit_ledger where idempotency_key = p_idempotency_key;
  if found then
    -- A replay must describe the same grant. Anything else is a bug upstream.
    if v_existing.user_id <> p_user_id or v_existing.amount <> p_amount
       or v_existing.kind <> p_kind or v_existing.bucket <> p_bucket then
      raise exception using errcode = 'RF409', message = 'idempotency_key_conflict';
    end if;
    return false;
  end if;

  if p_reset_bucket then
    select coalesce(sum(amount), 0) into v_remaining
    from public.credit_ledger
    where user_id = p_user_id and bucket = p_bucket;

    if v_remaining > 0 then
      insert into public.credit_ledger (user_id, amount, bucket, kind, idempotency_key, metadata)
      values (
        p_user_id, -v_remaining, p_bucket, 'expiry', p_idempotency_key || ':expire',
        jsonb_build_object('reason', 'no_rollover')
      );
    end if;
  end if;

  insert into public.credit_ledger (user_id, amount, bucket, kind, idempotency_key, metadata)
  values (p_user_id, p_amount, p_bucket, p_kind, p_idempotency_key, coalesce(p_metadata, '{}'::jsonb));

  return true;
end;
$$;

revoke all on function public.grant_credits(uuid, integer, text, text, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.grant_credits(uuid, integer, text, text, text, jsonb, boolean)
  to service_role;

-- Write off whatever is left in a bucket (used when a subscription ends).
-- Returns the number of credits removed; 0 on a replay or an empty bucket.
create function public.expire_credits(
  p_user_id uuid,
  p_bucket text,
  p_idempotency_key text,
  p_reason text default 'expired'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining integer;
begin
  if p_bucket is null or p_bucket not in ('subscription', 'free', 'pack') then
    raise exception using errcode = 'RF400', message = 'invalid_bucket';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 180 then
    raise exception using errcode = 'RF400', message = 'invalid_idempotency_key';
  end if;

  perform public.credits_lock_user(p_user_id);

  if exists (select 1 from public.credit_ledger where idempotency_key = p_idempotency_key) then
    return 0;
  end if;

  select coalesce(sum(amount), 0) into v_remaining
  from public.credit_ledger
  where user_id = p_user_id and bucket = p_bucket;

  if v_remaining <= 0 then
    return 0;
  end if;

  insert into public.credit_ledger (user_id, amount, bucket, kind, idempotency_key, metadata)
  values (
    p_user_id, -v_remaining, p_bucket, 'expiry', p_idempotency_key,
    jsonb_build_object('reason', left(coalesce(p_reason, 'expired'), 80))
  );

  return v_remaining;
end;
$$;

revoke all on function public.expire_credits(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.expire_credits(uuid, text, text, text) to service_role;

-- Balances for the signed-in user, creating the one-time signup grant on first
-- use. The grant amount comes from the app's pricing config, so the number of
-- free renders is set in one place (src/lib/config/pricing.ts).
create function public.credits_summary(p_user_id uuid, p_signup_grant integer)
returns table (total integer, subscription integer, free integer, pack integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'signup:' || p_user_id::text;
begin
  if p_signup_grant is null or p_signup_grant < 0 then
    raise exception using errcode = 'RF400', message = 'invalid_amount';
  end if;

  if p_signup_grant > 0
     and not exists (select 1 from public.credit_ledger where idempotency_key = v_key) then
    perform public.grant_credits(p_user_id, p_signup_grant, 'signup_grant', 'free', v_key);
  end if;

  return query select * from public.credit_balances(p_user_id);
end;
$$;

revoke all on function public.credits_summary(uuid, integer) from public, anon, authenticated;
grant execute on function public.credits_summary(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Spending: start a render and take its credits in one transaction
-- ---------------------------------------------------------------------------

-- Creates the render row and debits its credits atomically.
--
-- Returns the render id, whether this call created it, and the balance after.
-- `created` is false when the call matched an existing job and charged nothing:
--   * the same client_request_id was already used (double tap, client retry), or
--   * an HD final for the same preview is already in flight or finished.
create function public.start_render(
  p_user_id uuid,
  p_room_id uuid,
  p_tier text,
  p_mode text,
  p_params jsonb,
  p_prompt text,
  p_provider text,
  p_model text,
  p_credits integer,
  p_cost_usd numeric,
  p_deadline_seconds integer,
  p_source_render_id uuid default null,
  p_client_request_id uuid default null
)
returns table (render_id uuid, created boolean, balance integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_render_id uuid;
  v_source public.renders%rowtype;
  v_bucket text;
  v_available integer;
  v_take integer;
  v_remaining integer;
  v_total integer;
begin
  if p_credits is null or p_credits < 0 or p_credits > 100 then
    raise exception using errcode = 'RF400', message = 'invalid_credits';
  end if;
  if p_deadline_seconds is null or p_deadline_seconds not between 10 and 3600 then
    raise exception using errcode = 'RF400', message = 'invalid_deadline';
  end if;
  if p_tier is null or p_tier not in ('preview', 'hd') then
    raise exception using errcode = 'RF400', message = 'invalid_tier';
  end if;
  if p_mode is null or p_mode not in ('style', 'paint', 'material') then
    raise exception using errcode = 'RF400', message = 'invalid_mode';
  end if;
  if p_prompt is null or char_length(p_prompt) = 0 or p_provider is null or p_model is null then
    raise exception using errcode = 'RF400', message = 'invalid_render_input';
  end if;

  perform public.credits_lock_user(p_user_id);

  -- A repeat of a request we have already accepted: return that job, charge nothing.
  if p_client_request_id is not null then
    select r.id into v_render_id
    from public.renders r
    where r.user_id = p_user_id and r.client_request_id = p_client_request_id;
    if found then
      return query select v_render_id, false, (select b.total from public.credit_balances(p_user_id) b);
      return;
    end if;
  end if;

  perform 1 from public.rooms rm
  where rm.id = p_room_id and rm.user_id = p_user_id and rm.deleted_at is null;
  if not found then
    raise exception using errcode = 'RF404', message = 'room_not_found';
  end if;

  if p_tier = 'hd' then
    if p_source_render_id is null then
      raise exception using errcode = 'RF400', message = 'hd_requires_source_render';
    end if;

    select * into v_source from public.renders r where r.id = p_source_render_id;
    if not found or v_source.user_id <> p_user_id or v_source.room_id <> p_room_id then
      raise exception using errcode = 'RF404', message = 'source_render_not_found';
    end if;
    if v_source.tier <> 'preview' or v_source.status <> 'succeeded' then
      raise exception using errcode = 'RF409', message = 'source_render_not_ready';
    end if;

    -- One HD final per preview: reuse the one in flight or already made.
    select r.id into v_render_id
    from public.renders r
    where r.source_render_id = p_source_render_id
      and r.tier = 'hd'
      and r.status in ('queued', 'processing', 'succeeded')
    order by r.created_at desc
    limit 1;
    if found then
      return query select v_render_id, false, (select b.total from public.credit_balances(p_user_id) b);
      return;
    end if;
  elsif p_source_render_id is not null then
    raise exception using errcode = 'RF400', message = 'preview_cannot_have_source_render';
  end if;

  select b.total into v_total from public.credit_balances(p_user_id) b;
  if v_total < p_credits then
    raise exception using
      errcode = 'RF402',
      message = 'insufficient_credits',
      detail = format('balance=%s required=%s', v_total, p_credits);
  end if;

  insert into public.renders (
    user_id, room_id, source_render_id, tier, mode, params, prompt, provider, model,
    status, credits_charged, cost_usd, deadline_at, client_request_id
  )
  values (
    p_user_id, p_room_id, p_source_render_id, p_tier, p_mode, coalesce(p_params, '{}'::jsonb),
    p_prompt, p_provider, p_model, 'queued', p_credits, p_cost_usd,
    now() + make_interval(secs => p_deadline_seconds), p_client_request_id
  )
  returning id into v_render_id;

  -- Spend the credits that expire first.
  v_remaining := p_credits;
  foreach v_bucket in array array['subscription', 'free', 'pack'] loop
    exit when v_remaining <= 0;

    select coalesce(sum(l.amount), 0) into v_available
    from public.credit_ledger l
    where l.user_id = p_user_id and l.bucket = v_bucket;

    v_take := least(v_remaining, greatest(v_available, 0));
    if v_take > 0 then
      insert into public.credit_ledger (user_id, amount, bucket, kind, render_id, idempotency_key)
      values (
        p_user_id, -v_take, v_bucket, 'render_debit', v_render_id,
        'render:' || v_render_id::text || ':debit:' || v_bucket
      );
      v_remaining := v_remaining - v_take;
    end if;
  end loop;

  if v_remaining > 0 then
    -- Unreachable while the total check above holds; refuse rather than undercharge.
    raise exception using errcode = 'RF402', message = 'insufficient_credits';
  end if;

  return query select v_render_id, true, v_total - p_credits;
end;
$$;

revoke all on function public.start_render(
  uuid, uuid, text, text, jsonb, text, text, text, integer, numeric, integer, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.start_render(
  uuid, uuid, text, text, jsonb, text, text, text, integer, numeric, integer, uuid, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- Finishing a render
-- ---------------------------------------------------------------------------

-- Shared by fail_render and the stale-job sweeper. Marks an in-flight render
-- failed and gives back exactly what it was charged, to the buckets it came
-- from. Safe to call any number of times: only the first call changes anything.
create function public.credits_fail_render(
  p_render_id uuid,
  p_error_code text,
  p_error_message text,
  p_only_if_past_deadline boolean
)
returns table (changed boolean, refunded integer, balance integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_render public.renders%rowtype;
  v_debit record;
  v_refunded integer := 0;
  v_inserted integer;
begin
  select r.user_id into v_user_id from public.renders r where r.id = p_render_id;
  if not found then
    raise exception using errcode = 'RF404', message = 'render_not_found';
  end if;

  -- Lock order: profile first, then render.
  perform public.credits_lock_user(v_user_id);
  select * into v_render from public.renders r where r.id = p_render_id for update;

  if not found
     or v_render.status not in ('queued', 'processing')
     or (p_only_if_past_deadline and (v_render.deadline_at is null or v_render.deadline_at > now())) then
    return query select false, 0, (select b.total from public.credit_balances(v_user_id) b);
    return;
  end if;

  update public.renders
  set status = 'failed',
      error_code = left(coalesce(nullif(p_error_code, ''), 'unknown'), 60),
      error_message = left(p_error_message, 500),
      completed_at = now()
  where id = p_render_id;

  for v_debit in
    select l.bucket, sum(-l.amount)::integer as charged
    from public.credit_ledger l
    where l.render_id = p_render_id and l.kind = 'render_debit'
    group by l.bucket
  loop
    insert into public.credit_ledger (user_id, amount, bucket, kind, render_id, idempotency_key)
    values (
      v_user_id, v_debit.charged, v_debit.bucket, 'render_refund', p_render_id,
      'render:' || p_render_id::text || ':refund:' || v_debit.bucket
    )
    on conflict (idempotency_key) do nothing;

    get diagnostics v_inserted = row_count;
    if v_inserted > 0 then
      v_refunded := v_refunded + v_debit.charged;
    end if;
  end loop;

  return query select true, v_refunded, (select b.total from public.credit_balances(v_user_id) b);
end;
$$;

revoke all on function public.credits_fail_render(uuid, text, text, boolean)
  from public, anon, authenticated, service_role;

-- Mark a render failed and refund its credits.
create function public.fail_render(
  p_render_id uuid,
  p_error_code text,
  p_error_message text default null
)
returns table (changed boolean, refunded integer, balance integer)
language sql
security definer
set search_path = ''
as $$
  select * from public.credits_fail_render(p_render_id, p_error_code, p_error_message, false);
$$;

revoke all on function public.fail_render(uuid, text, text) from public, anon, authenticated;
grant execute on function public.fail_render(uuid, text, text) to service_role;

-- Fail and refund every in-flight render whose deadline has passed. Returns
-- the ids it failed. Safe to run from several places at once.
create function public.fail_stale_renders(p_limit integer default 100)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_changed boolean;
begin
  for v_id in
    select r.id
    from public.renders r
    where r.status in ('queued', 'processing')
      and r.deadline_at is not null
      and r.deadline_at <= now()
    order by r.deadline_at
    limit greatest(1, least(coalesce(p_limit, 100), 1000))
  loop
    -- The candidate list was read without locks, so the state is checked again
    -- under lock inside credits_fail_render before anything changes.
    select f.changed into v_changed
    from public.credits_fail_render(v_id, 'timeout', 'The render did not finish in time.', true) f;
    if v_changed then
      return next v_id;
    end if;
  end loop;
  return;
end;
$$;

revoke all on function public.fail_stale_renders(integer) from public, anon, authenticated;
grant execute on function public.fail_stale_renders(integer) to service_role;

-- Mark an in-flight render succeeded. Returns false when the render is no
-- longer in flight (for example it timed out and was refunded): a late result
-- is dropped rather than delivered for free.
create function public.complete_render(
  p_render_id uuid,
  p_result_path text,
  p_watermarked_path text,
  p_result_width integer,
  p_result_height integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_result_path is null or char_length(p_result_path) = 0 then
    raise exception using errcode = 'RF400', message = 'invalid_result_path';
  end if;

  select r.status into v_status from public.renders r where r.id = p_render_id for update;
  if not found then
    raise exception using errcode = 'RF404', message = 'render_not_found';
  end if;
  if v_status not in ('queued', 'processing') then
    return false;
  end if;

  update public.renders
  set status = 'succeeded',
      result_path = p_result_path,
      watermarked_path = p_watermarked_path,
      result_width = p_result_width,
      result_height = p_result_height,
      error_code = null,
      error_message = null,
      completed_at = now()
  where id = p_render_id;

  return true;
end;
$$;

revoke all on function public.complete_render(uuid, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.complete_render(uuid, text, text, integer, integer)
  to service_role;
