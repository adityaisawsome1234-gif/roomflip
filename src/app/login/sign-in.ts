import { z } from 'zod'

/**
 * Pure rules and wording for the sign-in screen: input validation, the
 * messages people see, and the mapping from Supabase failures to those
 * messages. No server or browser APIs, so the actions, the form and the unit
 * tests can all import it.
 */

export const CODE_LENGTH = 6

/** Seconds "Send a new code" stays disabled after each email. */
export const RESEND_COOLDOWN_SECONDS = 30

/** Longest address the email standard allows; anything longer is a mistake or abuse. */
const MAX_EMAIL_LENGTH = 254

export const emailSchema = z.string().trim().toLowerCase().max(MAX_EMAIL_LENGTH).pipe(z.email())

/** ASCII digits only: `\d` without the `u`/`v` flag never matches other scripts. */
export const codeSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${CODE_LENGTH}}$`))

export const SIGN_IN_MESSAGES = {
  invalidEmail: 'Enter a valid email address, like name@example.com.',
  rateLimited: 'Too many tries. Wait a minute and try again.',
  sendFailed: "We couldn't send the email. Try again.",
  codeFailed: "That code didn't work. Check it and try again, or send a new one.",
  googleFailed: "We couldn't start Google sign-in. Try again, or use your email.",
} as const

/** Result of asking for a sign-in email. The same for new and returning people. */
export type RequestSignInState =
  | { status: 'idle' }
  /** `email` is the normalised address the email went to. */
  | { status: 'sent'; email: string }
  /** `email` echoes what was typed, so the field is not wiped by the failed attempt. */
  | { status: 'error'; message: string; email: string }

/** Result of checking a 6-digit code. Success never returns: it redirects. */
export type VerifyCodeState = { status: 'idle' } | { status: 'error'; message: string }

export const REQUEST_IDLE: RequestSignInState = { status: 'idle' }
export const VERIFY_IDLE: VerifyCodeState = { status: 'idle' }

/** Errors that reach /login in the URL, set by /auth/confirm and /auth/callback. */
const URL_ERROR_MESSAGES: Record<string, string> = {
  link_expired:
    'That sign-in link has expired or was already used. Enter your email to get a new one.',
  link_invalid: "That sign-in link didn't work. Enter your email to get a new one.",
  oauth_failed: "Google sign-in didn't finish. Try again, or use your email instead.",
}

/** The message for a `?error=` value, or null for anything we do not recognise. */
export function urlErrorMessage(value: unknown): string | null {
  if (typeof value !== 'string' || !Object.hasOwn(URL_ERROR_MESSAGES, value)) return null
  return URL_ERROR_MESSAGES[value]
}

/** The parts of a Supabase auth error we look at. Its message text is never shown. */
export interface AuthFailure {
  code?: string | null
  status?: number | null
}

const RATE_LIMIT_CODES = new Set([
  'over_email_send_rate_limit',
  'over_request_rate_limit',
  'over_sms_send_rate_limit',
])

const INVALID_EMAIL_CODES = new Set(['email_address_invalid', 'validation_failed'])

function isRateLimited(failure: AuthFailure): boolean {
  return (failure.code != null && RATE_LIMIT_CODES.has(failure.code)) || failure.status === 429
}

/** What to tell someone when the sign-in email could not be sent. */
export function sendFailureMessage(failure: AuthFailure): string {
  if (isRateLimited(failure)) return SIGN_IN_MESSAGES.rateLimited
  if (failure.code != null && INVALID_EMAIL_CODES.has(failure.code)) {
    return SIGN_IN_MESSAGES.invalidEmail
  }
  return SIGN_IN_MESSAGES.sendFailed
}

/** What to tell someone when their code was not accepted. */
export function verifyFailureMessage(failure: AuthFailure): string {
  return isRateLimited(failure) ? SIGN_IN_MESSAGES.rateLimited : SIGN_IN_MESSAGES.codeFailed
}

/** Keep only the digits of whatever was typed or pasted ("123 456", "123-456"). */
export function digitsOnly(input: string): string {
  return input.replace(/\D/g, '').slice(0, CODE_LENGTH)
}
