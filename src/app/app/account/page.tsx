import type { Metadata } from 'next'
import { Suspense } from 'react'
import { signOut } from '@/lib/auth/actions'
import { requireUser } from '@/lib/auth/session'
import { CREDITS } from '@/lib/config/pricing'
import { ROUTES } from '@/lib/config/site'
import { getCreditBalances } from '@/lib/credits/ledger'
import { SignOutButton } from './sign-out-button'

export const metadata: Metadata = { title: 'Account' }

/**
 * Account tab. For now it shows who is signed in and lets them sign out.
 * The title is static; the part that reads the session streams in.
 */
export default function AccountPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="font-display text-4xl leading-tight tracking-tight">Account</h1>
      <Suspense fallback={<AccountPlaceholder />}>
        <Account />
      </Suspense>
    </div>
  )
}

async function Account() {
  const user = await requireUser(ROUTES.account)

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

      <CreditsCard userId={user.id} />

      {/* Plan and billing controls go here, above sign out, with Stripe (milestone 6). */}

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

/** Holds the page's space while the session is read. */
function AccountPlaceholder() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <div className="rounded-card bg-surface-sunken h-16" />
      <div className="bg-surface-sunken h-13 rounded-full" />
    </div>
  )
}
