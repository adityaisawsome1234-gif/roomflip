'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Paywall } from '@/components/billing/paywall'
import { Button } from '@/components/ui/button'

/** Shown when a render cannot start for lack of credits, or when a free user asks for HD. */
export function OutOfCredits({
  reason,
  autoOpen = false,
}: {
  reason: 'credits' | 'hd'
  /** Open the plans straight away (the person just tried to render); otherwise wait for a tap. */
  autoOpen?: boolean
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(autoOpen)
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
      <Button variant="accent" fullWidth onClick={() => setOpen(true)}>
        See plans
      </Button>
      <Paywall open={open} reason={reason} onClose={() => setOpen(false)} returnPath={pathname} />
    </div>
  )
}
