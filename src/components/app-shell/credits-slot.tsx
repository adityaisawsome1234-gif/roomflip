import Link from 'next/link'
import { Suspense } from 'react'
import { Sparkles } from 'lucide-react'
import { getSessionUser } from '@/lib/auth/session'
import { ROUTES } from '@/lib/config/site'
import { getCreditBalances } from '@/lib/credits/ledger'

/**
 * Right-hand side of the top bar: how many renders the user has left.
 *
 * The app layout around it is static, so the part that reads the session sits
 * behind its own Suspense boundary and streams in. While it loads, nothing
 * shows rather than a guess.
 */
export function CreditsSlot() {
  return (
    <Suspense fallback={null}>
      <CreditsBadge />
    </Suspense>
  )
}

async function CreditsBadge() {
  const user = await getSessionUser()
  if (!user) return null
  const { total } = await getCreditBalances(user.id)

  return (
    <Link
      href={ROUTES.account}
      aria-label={`${total} ${total === 1 ? 'render' : 'renders'} left. View account.`}
      className="border-line bg-surface text-ink hover:bg-surface-sunken flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold tabular-nums"
    >
      <Sparkles aria-hidden="true" className="text-accent size-4" />
      {total}
    </Link>
  )
}
