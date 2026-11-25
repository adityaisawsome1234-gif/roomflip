'use client'

import { useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { confirmEmailLink } from '@/lib/auth/actions'

/**
 * Submits the one-time token as soon as the page is interactive, so the
 * person who tapped the link is signed in without another tap. The button is
 * the fallback if scripting is slow or blocked.
 */
export function ConfirmForm({ tokenHash, type }: { tokenHash: string; type: string }) {
  const formRef = useRef<HTMLFormElement>(null)
  const submitted = useRef(false)

  useEffect(() => {
    if (submitted.current) return
    submitted.current = true
    formRef.current?.requestSubmit()
  }, [])

  return (
    <form ref={formRef} action={confirmEmailLink} className="flex flex-col gap-4">
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <h1 className="font-display text-3xl">Signing you in…</h1>
      <p className="text-muted">This takes a second. If nothing happens, tap continue.</p>
      <SubmitButton />
    </form>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" fullWidth disabled={pending}>
      {pending ? 'Signing in…' : 'Continue'}
    </Button>
  )
}
