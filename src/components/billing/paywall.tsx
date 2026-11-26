'use client'

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { PlanPicker } from './plan-picker'

export type PaywallReason = 'after_result' | 'credits' | 'hd'

const TITLES: Record<PaywallReason, { title: string; body: string }> = {
  after_result: {
    title: 'Love it? Keep going.',
    body: 'That was your last free render. Go Pro to try every style on every room.',
  },
  credits: {
    title: "You're out of renders",
    body: 'Pick a plan or a pack to keep restyling.',
  },
  hd: {
    title: 'Save it in HD with Pro',
    body: 'Full-resolution finals and clean, full-HD reels, with no watermark.',
  },
}

/**
 * The paywall, as a bottom sheet. The backdrop is light on purpose: the
 * before/after stays visible behind it, which is the reason to upgrade.
 */
export function Paywall({
  open,
  reason,
  onClose,
  returnPath,
}: {
  open: boolean
  reason: PaywallReason
  onClose: () => void
  returnPath: string
}) {
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (!open) return
    heading.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  const copy = TITLES[reason]

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/25"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="paywall-title"
        className="bg-surface rounded-t-card relative flex max-h-[88dvh] w-full max-w-md flex-col gap-4 overflow-y-auto px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2
              id="paywall-title"
              ref={heading}
              tabIndex={-1}
              className="font-display text-3xl leading-tight outline-none"
            >
              {copy.title}
            </h2>
            <p className="text-muted text-sm">{copy.body}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Not now"
            className="text-muted hover:bg-surface-sunken -mt-1 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        <PlanPicker returnPath={returnPath} />
      </section>
    </div>
  )
}
