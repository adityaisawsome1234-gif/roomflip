'use client'

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ClipboardEvent,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { requestSignIn, verifySignInCode } from './actions'
import { GoogleButton } from './google-button'
import {
  CODE_LENGTH,
  digitsOnly,
  REQUEST_IDLE,
  RESEND_COOLDOWN_SECONDS,
  SIGN_IN_MESSAGES,
  VERIFY_IDLE,
  type RequestSignInState,
  type VerifyCodeState,
} from './sign-in'
import { useSignInFlow } from './sign-in-flow'

export interface SignInFormProps {
  /** Where to go after sign-in. Already passed through safeNextPath by the page. */
  next: string
  /** Message for an error that arrived in the URL (expired link, failed Google sign-in). */
  urlError: string | null
  googleEnabled: boolean
}

/** The two-step sign-in form: ask for an email, then take the 6-digit code. */
export function SignInForm({ next, urlError, googleEnabled }: SignInFormProps) {
  const { sent } = useSignInFlow()

  return sent ? (
    // Keyed by address so a different email starts with a clean code field.
    <CodeStep key={sent.email} email={sent.email} sentAt={sent.at} next={next} />
  ) : (
    <EmailStep next={next} urlError={urlError} googleEnabled={googleEnabled} />
  )
}

/**
 * Focus a field by name. The shared Input does not take a ref, so fields are
 * reached through the form they belong to.
 */
function focusField(form: HTMLFormElement | null, name: string) {
  const field = form?.elements.namedItem(name)
  if (field instanceof HTMLElement) field.focus()
}

function ErrorMessage({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="rounded-control bg-danger-soft text-danger px-4 py-3 text-sm">
      {children}
    </p>
  )
}

function EmailStep({ next, urlError, googleEnabled }: SignInFormProps) {
  const { lastEmail, markSent } = useSignInFlow()
  const formRef = useRef<HTMLFormElement>(null)

  const [state, formAction, pending] = useActionState(
    async (previous: RequestSignInState, formData: FormData) => {
      const result = await requestSignIn(previous, formData)
      if (result.status === 'sent') markSent(result.email)
      return result
    },
    REQUEST_IDLE,
  )

  // Coming back from "Use a different email": put the cursor where the fix goes.
  useEffect(() => {
    if (lastEmail) focusField(formRef.current, 'email')
  }, [lastEmail])

  // The URL's error is shown until the person acts on it: a new attempt replaces it.
  const error =
    state.status === 'error' ? state.message : state.status === 'idle' && !lastEmail ? urlError : null

  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorMessage id="login-error">{error}</ErrorMessage>}

      {googleEnabled && (
        <>
          <GoogleButton next={next} />
          <div className="text-muted flex items-center gap-3 text-sm" aria-hidden="true">
            <span className="bg-line h-px flex-1" />
            or
            <span className="bg-line h-px flex-1" />
          </div>
        </>
      )}

      <form ref={formRef} action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <div className="flex flex-col gap-2">
          <label htmlFor="login-email" className="text-sm font-medium">
            Email
          </label>
          {/*
           * Uncontrolled on purpose: text typed before the page finishes loading is kept.
           * React resets a form to its default values after each submit, so the default
           * tracks what was last sent and a failed attempt does not wipe the field.
           */}
          <Input
            id="login-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            required
            maxLength={254}
            placeholder="name@example.com"
            defaultValue={state.status === 'error' ? state.email : lastEmail}
            invalid={state.status === 'error'}
            aria-describedby={error ? 'login-error' : undefined}
          />
        </div>
        <Button type="submit" variant="accent" size="lg" fullWidth disabled={pending}>
          {pending ? 'Sending…' : 'Email me a sign-in link'}
        </Button>
      </form>
    </div>
  )
}

type Feedback = { kind: 'error' | 'notice'; text: string } | null

function CodeStep({ email, sentAt, next }: { email: string; sentAt: number; next: string }) {
  const { markSent, startOver } = useSignInFlow()
  const formRef = useRef<HTMLFormElement>(null)
  // True from the moment a submit is accepted until its answer is back, so the
  // sixth digit and a quick tap on enter cannot both spend the code.
  const submitting = useRef(false)
  // The code most recently sent for checking: it is not auto-submitted twice.
  const lastTried = useRef('')
  const autoSubmit = useRef(false)

  const [code, setCode] = useState('')
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [resending, startResend] = useTransition()

  const [, verifyAction, verifying] = useActionState(
    async (previous: VerifyCodeState, formData: FormData) => {
      try {
        // On success the action redirects and this never resumes with a value.
        const result = (await verifySignInCode(previous, formData)) ?? previous
        if (result.status === 'error') setFeedback({ kind: 'error', text: result.message })
        return result
      } finally {
        submitting.current = false
      }
    },
    VERIFY_IDLE,
  )

  useEffect(() => {
    focusField(formRef.current, 'code')
  }, [])

  // Submit once the sixth digit lands. Runs after the field has re-rendered, so
  // the form holds the cleaned-up value (a pasted "123 456" is sent as 123456).
  useEffect(() => {
    if (!autoSubmit.current) return
    autoSubmit.current = false
    if (code.length === CODE_LENGTH) formRef.current?.requestSubmit()
  }, [code])

  function updateCode(raw: string) {
    const digits = digitsOnly(raw)
    if (digits.length === CODE_LENGTH && digits !== lastTried.current) autoSubmit.current = true
    setCode(digits)
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    // The field's maxlength would cut "123 456" to "123 45" before we could tidy it.
    event.preventDefault()
    updateCode(event.clipboardData.getData('text'))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (submitting.current) {
      event.preventDefault()
      return
    }
    submitting.current = true
    lastTried.current = code
    setFeedback(null)
  }

  function resend() {
    startResend(async () => {
      const formData = new FormData()
      formData.set('email', email)
      formData.set('next', next)
      const result = await requestSignIn(REQUEST_IDLE, formData)
      if (result.status === 'sent') {
        // The earlier code stops working once a new one is issued.
        lastTried.current = ''
        setCode('')
        setFeedback({
          kind: 'notice',
          text: 'We sent a new code. The earlier one no longer works.',
        })
        markSent(result.email)
        focusField(formRef.current, 'code')
      } else {
        setFeedback({
          kind: 'error',
          text: result.status === 'error' ? result.message : SIGN_IN_MESSAGES.sendFailed,
        })
      }
    })
  }

  const hasError = feedback?.kind === 'error'

  return (
    <div className="flex flex-col gap-6">
      {hasError && <ErrorMessage id="login-code-error">{feedback.text}</ErrorMessage>}

      <form
        ref={formRef}
        action={verifyAction}
        onSubmit={handleSubmit}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next} />
        <div className="flex flex-col gap-2">
          <label htmlFor="login-code" className="text-sm font-medium">
            6-digit code
          </label>
          <Input
            id="login-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern={`[0-9]{${CODE_LENGTH}}`}
            title="Enter the 6 digits from the email"
            maxLength={CODE_LENGTH}
            enterKeyHint="done"
            required
            value={code}
            onChange={(event) => updateCode(event.target.value)}
            onPaste={handlePaste}
            readOnly={verifying}
            invalid={hasError}
            aria-describedby={hasError ? 'login-code-error' : undefined}
            // Wide letter spacing leaves a gap after the last digit; the indent re-centres it.
            className="h-16 text-center font-mono text-3xl font-semibold tracking-[0.3em] indent-[0.3em] tabular-nums"
          />
        </div>
        <Button type="submit" variant="accent" size="lg" fullWidth disabled={verifying}>
          {verifying ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <div className="flex flex-col items-center gap-1">
        <p aria-live="polite" className="text-muted text-center text-sm">
          {feedback?.kind === 'notice' ? feedback.text : null}
        </p>
        {/* Remounted for each email sent, which restarts its countdown. */}
        <ResendButton key={sentAt} sentAt={sentAt} sending={resending} onResend={resend} />
        <Button variant="ghost" onClick={startOver} disabled={verifying}>
          Use a different email
        </Button>
      </div>
    </div>
  )
}

function ResendButton({
  sentAt,
  sending,
  onResend,
}: {
  sentAt: number
  sending: boolean
  onResend: () => void
}) {
  const [secondsLeft, setSecondsLeft] = useState(RESEND_COOLDOWN_SECONDS)

  // Count from the time the email went out rather than by ticks, so switching
  // to the mail app and back (which pauses timers) does not stretch the wait.
  useEffect(() => {
    const readyAt = sentAt + RESEND_COOLDOWN_SECONDS * 1000
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((readyAt - Date.now()) / 1000)))
    const timer = window.setInterval(update, 500)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }, [sentAt])

  const waiting = secondsLeft > 0
  return (
    <Button variant="ghost" onClick={onResend} disabled={waiting || sending}>
      {sending ? 'Sending…' : waiting ? `Send a new code in ${secondsLeft}s` : 'Send a new code'}
    </Button>
  )
}
