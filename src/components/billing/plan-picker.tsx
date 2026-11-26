'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import {
  CREDIT_PACKS,
  formatUsd,
  PLANS,
  type CreditPackId,
  type PlanId,
} from '@/lib/config/pricing'

type Item = PlanId | CreditPackId

const PLAN_ORDER: PlanId[] = ['pro_annual', 'pro_weekly']
const PACK_ORDER: CreditPackId[] = ['pack_20', 'pack_60']

function planSummary(id: PlanId): { price: string; detail: string; badge?: string } {
  const plan = PLANS[id]
  if (plan.interval === 'year') {
    const weekly = formatUsd(Math.floor((plan.priceUsd / 52) * 100) / 100)
    return {
      price: `${formatUsd(plan.priceUsd)} a year`,
      detail: `${plan.credits.amount} renders a month · about ${weekly} a week`,
      badge: 'Best value',
    }
  }
  return {
    price: `${formatUsd(plan.priceUsd)} a week`,
    detail: `${plan.credits.amount} renders a week`,
  }
}

/** Start Stripe Checkout and leave the page. Returns an error message on failure. */
export async function goToCheckout(item: Item, returnPath: string): Promise<string | null> {
  try {
    const response = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item, returnPath }),
    })
    const json = await response.json().catch(() => null)
    if (!response.ok || !json?.url)
      return json?.error?.message ?? "Checkout didn't open. Try again."
    window.location.assign(json.url)
    return null
  } catch {
    return 'No connection. Try again.'
  }
}

/** The plans and packs, with one button to check out. */
export function PlanPicker({ returnPath }: { returnPath: string }) {
  const [selected, setSelected] = useState<Item>('pro_annual')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function checkout(item: Item) {
    setBusy(true)
    setError(null)
    const failure = await goToCheckout(item, returnPath)
    if (failure) {
      setError(failure)
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-1.5 text-sm">
        {['No watermark on images and videos', 'HD finals and full-HD reels', 'Cancel anytime'].map(
          (benefit) => (
            <li key={benefit} className="flex items-center gap-2">
              <Check aria-hidden="true" className="text-accent size-4 shrink-0" />
              {benefit}
            </li>
          ),
        )}
      </ul>

      <div role="radiogroup" aria-label="Plan" className="flex flex-col gap-2">
        {PLAN_ORDER.map((id) => {
          const summary = planSummary(id)
          const on = selected === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setSelected(id)}
              className={cn(
                'rounded-card flex items-center justify-between gap-3 border p-4 text-left',
                on ? 'border-ink ring-ink ring-1' : 'border-line',
              )}
            >
              <span className="flex flex-col">
                <span className="flex items-center gap-2 font-semibold">
                  {PLANS[id].name}
                  {summary.badge && (
                    <span className="bg-accent text-accent-ink rounded-full px-2 py-0.5 text-[11px] font-bold">
                      {summary.badge}
                    </span>
                  )}
                </span>
                <span className="text-muted text-sm">{summary.detail}</span>
              </span>
              <span className="shrink-0 text-right text-sm font-semibold">{summary.price}</span>
            </button>
          )
        })}
      </div>

      {error && (
        <p role="alert" className="rounded-control bg-danger-soft text-danger px-4 py-3 text-sm">
          {error}
        </p>
      )}

      <Button
        variant="accent"
        size="lg"
        fullWidth
        disabled={busy}
        onClick={() => checkout(selected)}
      >
        {busy ? 'Opening checkout…' : `Continue with ${PLANS[selected as PlanId]?.name ?? 'Pro'}`}
      </Button>
      <p className="text-muted text-center text-xs">
        Renews automatically. Cancel anytime from your account.
      </p>

      <div className="border-line flex flex-col gap-2 border-t pt-4">
        <p className="text-muted text-center text-sm">Or buy renders once. They never expire.</p>
        <div className="grid grid-cols-2 gap-2">
          {PACK_ORDER.map((id) => (
            <Button key={id} variant="secondary" disabled={busy} onClick={() => checkout(id)}>
              {CREDIT_PACKS[id].credits} for {formatUsd(CREDIT_PACKS[id].priceUsd)}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
