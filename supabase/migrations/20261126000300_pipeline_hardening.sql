-- Hardening from the milestone 3 review.
--
-- 1. Refunds respect expiry. A render paid with plan credits that fails after
--    the plan renewed (or ended) must not bring back a credit that was already
--    written off. The refund is still recorded, and matched by an expiry.
-- 2. The stale-render sweep no longer holds many users' locks in one
--    transaction: it lists candidates without locks, and each one is failed in
--    its own transaction (see failStaleRenders in src/lib/credits/ledger.ts).
-- 3. Failing a render that is already finished takes no lock at all.
-- 4. Submitting a render to a provider is claimed atomically, using the
--    database clock, so a poll, a webhook and the request that created the
--    render never submit the same render twice.

-- ---------------------------------------------------------------------------
-- 1 + 3: credits_fail_render
-- ---------------------------------------------------------------------------
create or replace function public.credits_fail_render(
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
  v_status text;
  v_render public.renders%rowtype;
  v_debit record;
  v_refunded integer := 0;
  v_inserted integer;
begin
  select r.user_id, r.status into v_user_id, v_status from public.renders r where r.id = p_render_id;
  if not found then
    raise exception using errcode = 'RF404', message = 'render_not_found';
  end if;

  -- Already finished: nothing to do, and no reason to queue behind the user's lock.
  if v_status not in ('queued', 'processing') then
    return query select false, 0, (select b.total from public.credit_balances(v_user_id) b);
    return;
  end if;

  -- Lock order: profile first, then render. Re-check everything under the locks.
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
    select l.bucket, sum(-l.amount)::integer as charged, min(l.created_at) as debited_at
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
    continue when v_inserted = 0;

    -- The bucket was reset after this credit was spent (a no-rollover renewal,
    -- or the plan ended): the credit would have expired, so it expires now too.
    -- A reset shows as an expiry row, or as a grant marked reset when there was
    -- nothing left to write off.
    if exists (
      select 1 from public.credit_ledger e
      where e.user_id = v_user_id
        and e.bucket = v_debit.bucket
        and e.created_at >= v_debit.debited_at
        and (e.kind = 'expiry' or (e.amount > 0 and e.metadata ->> 'reset' = 'true'))
    ) then
      insert into public.credit_ledger (user_id, amount, bucket, kind, render_id, idempotency_key, metadata)
      values (
        v_user_id, -v_debit.charged, v_debit.bucket, 'expiry', p_render_id,
        'render:' || p_render_id::text || ':refund-expired:' || v_debit.bucket,
        jsonb_build_object('reason', 'refund_after_expiry')
      )
      on conflict (idempotency_key) do nothing;
    else
      v_refunded := v_refunded + v_debit.charged;
    end if;
  end loop;

  return query select true, v_refunded, (select b.total from public.credit_balances(v_user_id) b);
end;
$$;

revoke all on function public.credits_fail_render(uuid, text, text, boolean)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- grant_credits: mark grants that reset their bucket, so a later refund can
-- tell that the period it was spent in is over (see credits_fail_render).
-- ---------------------------------------------------------------------------
create or replace function public.grant_credits(
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
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
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
    if v_existing.user_id <> p_user_id or v_existing.amount <> p_amount
       or v_existing.kind <> p_kind or v_existing.bucket <> p_bucket then
      raise exception using errcode = 'RF409', message = 'idempotency_key_conflict';
    end if;
    return false;
  end if;

  if p_reset_bucket then
    v_metadata := v_metadata || jsonb_build_object('reset', true);
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
  values (p_user_id, p_amount, p_bucket, p_kind, p_idempotency_key, v_metadata);

  return true;
end;
$$;

revoke all on function public.grant_credits(uuid, integer, text, text, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.grant_credits(uuid, integer, text, text, text, jsonb, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2: per-render sweeping
-- ---------------------------------------------------------------------------
drop function public.fail_stale_renders(integer);

-- In-flight renders past their deadline. Reads only; takes no locks.
create function public.list_stale_renders(p_limit integer default 100)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id
  from public.renders r
  where r.status in ('queued', 'processing')
    and r.deadline_at is not null
    and r.deadline_at <= now()
  order by r.deadline_at
  limit greatest(1, least(coalesce(p_limit, 100), 1000));
$$;

revoke all on function public.list_stale_renders(integer) from public, anon, authenticated;
grant execute on function public.list_stale_renders(integer) to service_role;

-- Fail and refund one render, but only if it is still in flight and past its
-- deadline (checked under lock). Returns true when this call failed it.
create function public.fail_stale_render(p_render_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select f.changed
  from public.credits_fail_render(p_render_id, 'timeout', 'The render did not finish in time.', true) f;
$$;

revoke all on function public.fail_stale_render(uuid) from public, anon, authenticated;
grant execute on function public.fail_stale_render(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4: claiming a submission
-- ---------------------------------------------------------------------------

-- Take the right to (re)submit a render to its provider. Exactly one caller
-- wins. Two cases:
--   p_expected_request_id set:  replace that failed provider job. Clearing the
--     old id is the claim, so a second caller holding the same id loses.
--   p_expected_request_id null: the render has no provider job yet. The claim
--     stamps last_checked_at; another caller can only take over once that
--     stamp is older than p_stale_seconds (the previous submitter died).
-- No claim once the render has used p_max_attempts submissions.
create function public.claim_render_submission(
  p_render_id uuid,
  p_expected_request_id text,
  p_stale_seconds integer,
  p_max_attempts integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.renders r
  set provider_request_id = null,
      provider_endpoint = null,
      last_checked_at = now()
  where r.id = p_render_id
    and r.status in ('queued', 'processing')
    and r.attempts < p_max_attempts
    and (
      (p_expected_request_id is not null and r.provider_request_id = p_expected_request_id)
      or (
        p_expected_request_id is null
        and r.provider_request_id is null
        and (r.last_checked_at is null
             or r.last_checked_at < now() - make_interval(secs => p_stale_seconds))
      )
    );
  return found;
end;
$$;

revoke all on function public.claim_render_submission(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_render_submission(uuid, text, integer, integer)
  to service_role;

-- Throttle provider status checks with the database clock: true when this
-- caller should ask the provider now.
create function public.claim_render_check(
  p_render_id uuid,
  p_request_id text,
  p_interval_ms integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.renders r
  set last_checked_at = now()
  where r.id = p_render_id
    and r.status in ('queued', 'processing')
    and r.provider_request_id = p_request_id
    and (r.last_checked_at is null
         or r.last_checked_at < now() - make_interval(secs => p_interval_ms / 1000.0));
  return found;
end;
$$;

revoke all on function public.claim_render_check(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_render_check(uuid, text, integer) to service_role;
