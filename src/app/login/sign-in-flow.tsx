'use client'

import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react'

/**
 * Which step of sign-in the screen is on, shared between the heading (part of
 * the prerendered shell) and the form (which streams in once the URL is known).
 */
interface SignInFlow {
  /** Set once a sign-in email has gone out: the screen is on the "check your email" step. */
  sent: { email: string; at: number } | null
  /** The last address used, so "Use a different email" starts from it rather than from blank. */
  lastEmail: string
  /** Record that an email went to `email` just now. Also restarts the resend countdown. */
  markSent: (email: string) => void
  /** Go back to the email step. */
  startOver: () => void
}

const SignInFlowContext = createContext<SignInFlow | null>(null)

export function SignInFlowProvider({ children }: { children: ReactNode }) {
  const [sent, setSent] = useState<SignInFlow['sent']>(null)
  const [lastEmail, setLastEmail] = useState('')

  const markSent = useCallback((email: string) => {
    setSent({ email, at: Date.now() })
    setLastEmail(email)
  }, [])
  const startOver = useCallback(() => setSent(null), [])

  const value = useMemo(
    () => ({ sent, lastEmail, markSent, startOver }),
    [sent, lastEmail, markSent, startOver],
  )
  return <SignInFlowContext value={value}>{children}</SignInFlowContext>
}

export function useSignInFlow(): SignInFlow {
  const flow = use(SignInFlowContext)
  if (!flow) throw new Error('useSignInFlow must be used inside <SignInFlowProvider>')
  return flow
}

/**
 * Screen title and the line under it. The line is a live region that is always
 * mounted, so screen readers announce the move to "check your email".
 */
export function SignInHeading() {
  const { sent } = useSignInFlow()

  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-display text-4xl leading-tight tracking-tight">
        {sent ? 'Check your email' : 'Sign in'}
      </h1>
      <p aria-live="polite" className="text-muted">
        {sent ? (
          <>
            We sent a link and a 6-digit code to{' '}
            <strong className="text-ink font-medium break-all">{sent.email}</strong>. Tap the link,
            or enter the code here.
          </>
        ) : (
          'Enter your email to sign in or create an account. No password needed.'
        )}
      </p>
    </div>
  )
}
