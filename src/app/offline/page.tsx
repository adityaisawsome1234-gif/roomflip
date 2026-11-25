import type { Metadata } from 'next'
import { WifiOff } from 'lucide-react'
import { Logo } from '@/components/ui/logo'
import { TryAgainButton } from './try-again-button'

export const metadata: Metadata = {
  title: 'Offline',
  robots: { index: false },
}

/**
 * Shown by the service worker (public/sw.js) when a page load fails because
 * there is no network. The worker stores this page when it installs, so it
 * must stay fully static: no data, no session, nothing personal.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-6 py-16">
      <Logo />
      <div className="flex flex-col gap-4">
        <span className="bg-surface-sunken text-muted flex size-14 items-center justify-center rounded-full">
          <WifiOff aria-hidden="true" className="size-6" />
        </span>
        <h1 className="font-display text-5xl leading-[1.05] tracking-tight">You&apos;re offline</h1>
        <p className="text-muted text-lg">Check your connection, then try again.</p>
      </div>
      <TryAgainButton />
    </main>
  )
}
