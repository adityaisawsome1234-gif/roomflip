import type { Metadata } from 'next'
import Link from 'next/link'
import { Images } from 'lucide-react'
import { buttonClasses } from '@/components/ui/button'
import { ROUTES } from '@/lib/config/site'

export const metadata: Metadata = { title: 'My rooms' }

/**
 * My rooms tab. Saved rooms arrive with the restyle flow in a later milestone,
 * so for now this is only the empty state.
 */
export default function RoomsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="font-display text-4xl leading-tight tracking-tight">My rooms</h1>

      <section className="flex flex-1 flex-col items-center justify-center gap-6 py-8 text-center">
        <span className="bg-surface-sunken text-muted flex size-16 items-center justify-center rounded-full">
          <Images aria-hidden="true" className="size-7" />
        </span>
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">No rooms yet</h2>
          <p className="text-muted">Saved before-and-afters will appear here.</p>
        </div>
        <Link href={ROUTES.app} className={buttonClasses({ variant: 'accent', size: 'lg' })}>
          Restyle a room
        </Link>
      </section>
    </div>
  )
}
