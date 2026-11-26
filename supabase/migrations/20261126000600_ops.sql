-- Operations (milestone 7): rate limiting and admin reporting. Server only.

-- ---------------------------------------------------------------------------
-- Rate limits: fixed-window counters keyed by what is limited, e.g.
-- "render:user:<id>" or "upload:ip:<address>". One atomic statement per hit,
-- so concurrent requests are counted exactly.
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key text not null check (char_length(key) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (key, window_start)
);

alter table public.rate_limits enable row level security;

create index rate_limits_window_idx on public.rate_limits (window_start);

-- Count one hit and say whether it is allowed. Returns the hits in the current
-- window (including this one) and the seconds until the window resets.
create function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, hits integer, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_limit is null or p_limit < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception using errcode = 'RF400', message = 'invalid_rate_limit';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  return query select
    v_hits <= p_limit,
    v_hits,
    greatest(1, ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - now())))::integer);
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- Drop windows that ended more than a day ago (run by the daily cron).
create function public.rate_limit_cleanup()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.rate_limits where window_start < now() - interval '1 day' returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.rate_limit_cleanup() from public, anon, authenticated;
grant execute on function public.rate_limit_cleanup() to service_role;

-- ---------------------------------------------------------------------------
-- Admin reporting. Model spend counts every submission (attempts), because the
-- provider bills each one, including renders that failed and were refunded.
-- ---------------------------------------------------------------------------
create function public.admin_overview(p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'users_total', (select count(*) from public.profiles),
    'users_new', (select count(*) from public.profiles where created_at >= p_since),
    'renders', (select count(*) from public.renders where created_at >= p_since),
    'renders_succeeded', (select count(*) from public.renders where created_at >= p_since and status = 'succeeded'),
    'renders_failed', (select count(*) from public.renders where created_at >= p_since and status = 'failed'),
    'model_spend_usd', (
      select coalesce(sum(cost_usd * attempts), 0) from public.renders where created_at >= p_since
    ),
    'revenue_cents', (select coalesce(sum(amount_cents), 0) from public.payments where created_at >= p_since),
    'revenue_cents_all_time', (select coalesce(sum(amount_cents), 0) from public.payments),
    'paying_users', (select count(distinct user_id) from public.payments),
    'active_subscriptions', (
      select count(*) from public.subscriptions
      where status in ('active', 'trialing', 'past_due') and current_period_end > now()
    ),
    'exports', (select count(*) from public.exports where created_at >= p_since)
  );
$$;

create function public.admin_model_costs(p_since timestamptz)
returns table (
  model text,
  tier text,
  renders bigint,
  succeeded bigint,
  failed bigint,
  submissions bigint,
  avg_cost_usd numeric,
  spend_usd numeric,
  avg_seconds numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.model,
    r.tier,
    count(*),
    count(*) filter (where r.status = 'succeeded'),
    count(*) filter (where r.status = 'failed'),
    coalesce(sum(r.attempts), 0),
    round(avg(r.cost_usd), 4),
    round(coalesce(sum(r.cost_usd * r.attempts), 0), 4),
    round(avg(extract(epoch from (r.completed_at - r.created_at))) filter (where r.status = 'succeeded'), 1)
  from public.renders r
  where r.created_at >= p_since
  group by r.model, r.tier
  order by count(*) desc;
$$;

create function public.admin_revenue(p_since timestamptz)
returns table (item_id text, kind text, payments bigint, amount_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select p.item_id, p.kind, count(*), coalesce(sum(p.amount_cents), 0)
  from public.payments p
  where p.created_at >= p_since
  group by p.item_id, p.kind
  order by sum(p.amount_cents) desc;
$$;

create function public.admin_users(p_search text, p_limit integer)
returns table (
  id uuid,
  email text,
  created_at timestamptz,
  renders bigint,
  balance bigint,
  plan text,
  revenue_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.email,
    p.created_at,
    (select count(*) from public.renders r where r.user_id = p.id),
    (select coalesce(sum(l.amount), 0) from public.credit_ledger l where l.user_id = p.id),
    (
      select s.plan_id from public.subscriptions s
      where s.user_id = p.id and s.status in ('active', 'trialing', 'past_due') and s.current_period_end > now()
      order by s.current_period_end desc limit 1
    ),
    (select coalesce(sum(pay.amount_cents), 0) from public.payments pay where pay.user_id = p.id)
  from public.profiles p
  where p_search is null or p_search = '' or p.email ilike '%' || replace(replace(p_search, '%', ''), '_', '') || '%'
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

create function public.admin_recent_renders(p_limit integer)
returns table (
  id uuid,
  created_at timestamptz,
  email text,
  mode text,
  tier text,
  model text,
  status text,
  error_code text,
  attempts smallint,
  cost_usd numeric,
  seconds numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.created_at, p.email, r.mode, r.tier, r.model, r.status, r.error_code, r.attempts,
         r.cost_usd, round(extract(epoch from (r.completed_at - r.created_at)), 1)
  from public.renders r
  join public.profiles p on p.id = r.user_id
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.admin_overview(timestamptz) from public, anon, authenticated;
revoke all on function public.admin_model_costs(timestamptz) from public, anon, authenticated;
revoke all on function public.admin_revenue(timestamptz) from public, anon, authenticated;
revoke all on function public.admin_users(text, integer) from public, anon, authenticated;
revoke all on function public.admin_recent_renders(integer) from public, anon, authenticated;
grant execute on function public.admin_overview(timestamptz) to service_role;
grant execute on function public.admin_model_costs(timestamptz) to service_role;
grant execute on function public.admin_revenue(timestamptz) to service_role;
grant execute on function public.admin_users(text, integer) to service_role;
grant execute on function public.admin_recent_renders(integer) to service_role;
