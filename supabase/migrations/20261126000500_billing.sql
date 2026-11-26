-- Billing (milestone 6): Stripe customers, subscriptions, payments and the
-- webhook event log. Server access only: no client grants, RLS on.
--
-- Stripe is the source of truth for money; these tables mirror what the
-- webhooks report, so the app can answer "is this user on a plan?" and the
-- admin page can report revenue without calling Stripe.

create table public.billing_customers (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

alter table public.billing_customers enable row level security;

create table public.subscriptions (
  -- Stripe subscription id (sub_...).
  id text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan_id text not null check (plan_id in ('pro_weekly', 'pro_annual')),
  -- Stripe's status: active, trialing, past_due, canceled, unpaid, incomplete, ...
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create index subscriptions_user_idx on public.subscriptions (user_id, current_period_end desc);
create index subscriptions_active_annual_idx on public.subscriptions (plan_id, status)
  where status in ('active', 'trialing', 'past_due');

create table public.payments (
  -- Stripe invoice id (in_...) for plans, checkout session id (cs_...) for packs.
  id text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('subscription', 'pack')),
  -- A plan or pack id from src/lib/config/pricing.ts.
  item_id text not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null check (char_length(currency) = 3),
  created_at timestamptz not null default now()
);

alter table public.payments enable row level security;

create index payments_created_idx on public.payments (created_at desc);
create index payments_user_idx on public.payments (user_id, created_at desc);

create table public.stripe_events (
  -- Stripe event id (evt_...). Deliveries of the same event share it.
  id text primary key,
  type text not null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'failed')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.stripe_events enable row level security;
