import type { Metadata } from 'next'
import { Suspense } from 'react'
import { signOut } from '@/lib/auth/actions'
import { requireUser } from '@/lib/auth/session'
import { ROUTES } from '@/lib/config/site'
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

      {/* Plan, credit balance and billing go here, above sign out, once the credits ledger exists. */}

      <form action={signOut}>
        <SignOutButton />
      </form>
    </div>
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
