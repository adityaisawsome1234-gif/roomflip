import Link from 'next/link'
import { buttonClasses } from '@/components/ui/button'
import { ROUTES } from '@/lib/config/site'

/**
 * Shown when a render cannot start for lack of credits, or when a free user
 * asks for HD. Milestone 6 replaces the link with the paywall sheet.
 */
export function OutOfCredits({ reason }: { reason: 'credits' | 'hd' }) {
  return (
    <div role="alert" className="rounded-card bg-accent-soft flex flex-col gap-3 p-4">
      <p className="font-semibold">
        {reason === 'credits' ? "You've used all your renders" : 'HD is part of Pro'}
      </p>
      <p className="text-sm">
        {reason === 'credits'
          ? 'Get more renders to keep restyling.'
          : 'Pro saves your favourite looks in full resolution, without the watermark.'}
      </p>
      <Link href={ROUTES.account} className={buttonClasses({ variant: 'accent', fullWidth: true })}>
        See plans
      </Link>
    </div>
  )
}
