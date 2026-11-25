import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { buttonClasses } from '@/components/ui/button'
import { Logo } from '@/components/ui/logo'
import { ROUTES } from '@/lib/config/site'
import { ConfirmForm } from './confirm-form'

export const metadata: Metadata = {
  title: 'Signing you in',
  robots: { index: false, follow: false },
  // The URL carries a one-time token: never send it on as a Referer.
  referrer: 'no-referrer',
}

/**
 * Landing page for the sign-in link in the email. The token is not used on
 * load; the form below POSTs it. That keeps mail scanners that fetch links
 * with a plain GET from burning the token before the person taps it.
 */
export default function ConfirmPage({ searchParams }: PageProps<'/auth/confirm'>) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-6 py-12">
      <Logo />
      <Suspense fallback={<p className="text-muted">Signing you in…</p>}>
        <Confirm searchParams={searchParams} />
      </Suspense>
    </main>
  )
}

async function Confirm({ searchParams }: Pick<PageProps<'/auth/confirm'>, 'searchParams'>) {
  const params = await searchParams
  const tokenHash = typeof params.token_hash === 'string' ? params.token_hash : ''
  const type = typeof params.type === 'string' ? params.type : ''

  if (!tokenHash || !type) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-3xl">This link isn&apos;t complete</h1>
        <p className="text-muted">
          Open the newest sign-in email and tap the button again, or ask for a fresh link.
        </p>
        <Link href={ROUTES.login} className={buttonClasses({ size: 'lg', fullWidth: true })}>
          Back to sign in
        </Link>
      </div>
    )
  }

  return <ConfirmForm tokenHash={tokenHash} type={type} />
}
