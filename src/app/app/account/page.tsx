import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ManageBillingButton } from '@/components/billing/manage-button'
import { PlanPicker } from '@/components/billing/plan-picker'
import { signOut } from '@/lib/auth/actions'
import { requireUser } from '@/lib/auth/session'
import { CREDITS, PLANS, type PlanId } from '@/lib/config/pricing'
import { ROUTES } from '@/lib/config/site'
import { getCreditBalances } from '@/lib/credits/ledger'
import { createAdminClient } from '@/lib/supabase/admin'
import { SignOutButton } from './sign-out-button'

export const metadata: Metadata = { title: 'Account' }

/**
 * Account tab. For now it shows who is signed in and lets them sign out.
 * The title is static; the part that reads the session streams in.
 */
export default function AccountPage({ searchParams }: PageProps<'/app/account'>) {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="font-display text-4xl leading-tight tracking-tight">Account</h1>
      <Suspense fallback={<AccountPlaceholder />}>
        <Account searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Account({ searchParams }: Pick<PageProps<'/app/account'>, 'searchParams'>) {
  const user = await requireUser(ROUTES.account)
  const params = await searchParams
  const checkoutDone = params.checkout === 'success'

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-label="Signed-in account"
        className="rounded-card border-line bg-surface border p-5"
      >
        <p className="break-words">
          <span className="text-muted">Signed in as</span>{' '}
          <span className="font-medium break-all">{user.email ?? 'your account'}</span>
        </p>
      </section>

      {checkoutDone && (
        <p role="status" className="rounded-card bg-accent-soft p-4 text-sm">
          Thanks, your payment went through. New renders can take a few seconds to appear; refresh
          if you don&apos;t see them yet.
        </p>
      )}

      <CreditsCard userId={user.id} />

      <PlanCard userId={user.id} />

      <form action={signOut}>
        <SignOutButton />
      </form>
    </div>
  )
}

/** What the user has left, and where it came from. */
async function CreditsCard({ userId }: { userId: string }) {
  const balances = await getCreditBalances(userId)
  const sources = [
    {
      label: 'From your plan',
      note: 'Unused ones reset when your plan renews',
      value: balances.subscription,
    },
    { label: 'Free', note: 'Never expire', value: balances.free },
    { label: 'Purchased', note: 'Never expire', value: balances.pack },
  ].filter((source) => source.value > 0)

  return (
    <section
      aria-labelledby="credits-heading"
      className="rounded-card border-line bg-surface border p-5"
    >
      <h2 id="credits-heading" className="text-muted text-sm font-medium">
        Renders left
      </h2>
      <p className="mt-1 text-4xl font-semibold tabular-nums">{balances.total}</p>
      {sources.length > 0 && (
        <dl className="border-line mt-4 flex flex-col gap-3 border-t pt-4 text-sm">
          {sources.map((source) => (
            <div key={source.label} className="flex items-baseline justify-between gap-4">
              <dt>
                <span className="font-medium">{source.label}</span>
                <span className="text-muted block">{source.note}</span>
              </dt>
              <dd className="font-semibold tabular-nums">{source.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-muted mt-4 text-sm">
        Each new look uses {CREDITS.cost.preview}. Saving it in HD uses {CREDITS.cost.hd} more.
      </p>
    </section>
  )
}

/** The current plan and how to change it, or the plans on offer. */
async function PlanCard({ userId }: { userId: string }) {
  const db = createAdminClient()
  const [{ data: subscription }, { data: customer }] = await Promise.all([
    db
      .from('subscriptions')
      .select('plan_id, status, current_period_end, cancel_at_period_end')
      .eq('user_id', userId)
      .in('status', ['active', 'trialing', 'past_due'])
      .gt('current_period_end', new Date().toISOString())
      .order('current_period_end', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from('billing_customers').select('user_id').eq('user_id', userId).maybeSingle(),
  ])

  if (subscription) {
    const plan = PLANS[subscription.plan_id as PlanId]
    const date = new Date(subscription.current_period_end!).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
    })
    return (
      <section
        aria-labelledby="plan-heading"
        className="rounded-card border-line bg-surface flex flex-col gap-4 border p-5"
      >
        <div className="flex flex-col gap-1">
          <h2 id="plan-heading" className="text-muted text-sm font-medium">
            Your plan
          </h2>
          <p className="text-xl font-semibold">{plan?.name ?? 'Pro'}</p>
          <p className="text-muted text-sm">
            {subscription.status === 'past_due'
              ? 'Your last payment failed. Update your card to keep Pro.'
              : subscription.cancel_at_period_end
                ? `Ends on ${date}. You keep Pro until then.`
                : `Renews on ${date}.`}
          </p>
        </div>
        <ManageBillingButton />
      </section>
    )
  }

  return (
    <section
      aria-labelledby="plans-heading"
      className="rounded-card border-line bg-surface flex flex-col gap-4 border p-5"
    >
      <h2 id="plans-heading" className="text-lg font-semibold">
        Go Pro
      </h2>
      <PlanPicker returnPath={ROUTES.account} />
      {customer && <ManageBillingButton label="Receipts and billing" />}
    </section>
  )
}

/** Holds the page's space while the session is read. */
function AccountPlaceholder() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <div className="rounded-card bg-surface-sunken h-16" />
      <div className="bg-surface-sunken h-13 rounded-full" />
    </div>
  )
}
