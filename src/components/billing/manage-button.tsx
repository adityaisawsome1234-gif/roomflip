'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

/** Opens Stripe's customer portal: change plan, update card, cancel, invoices. */
export function ManageBillingButton({ label = 'Manage subscription' }: { label?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function open() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/billing/portal', { method: 'POST' })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.url)
        throw new Error(json?.error?.message ?? "Billing settings didn't open.")
      window.location.assign(json.url)
    } catch (caught) {
      setError(
        caught instanceof TypeError ? 'No connection. Try again.' : (caught as Error).message,
      )
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" size="lg" fullWidth onClick={open} disabled={busy}>
        {busy ? 'Opening…' : label}
      </Button>
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
    </div>
  )
}
