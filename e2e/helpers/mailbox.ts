/**
 * Reads the local test mailbox. The Supabase CLI stack runs Mailpit, which
 * catches every email the auth server sends and exposes it over HTTP.
 */
const MAILPIT_URL = (process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324').replace(/\/+$/, '')

export interface SignInEmail {
  /** Mailpit's id for the message. */
  id: string
  to: string
  subject: string
  /** When the mailbox received it. */
  receivedAt: Date
  /** The sign-in link (…/auth/confirm?token_hash=…&type=email). */
  link: string
  /** The 6-digit code, kept as a string because it can start with 0. */
  code: string
}

/** One row of a Mailpit search result. */
interface MailpitSummary {
  ID: string
  Created: string
  Subject: string
}

/** The parts of GET /api/v1/message/<ID> that we read. */
interface MailpitBody {
  Text: string
  HTML: string
}

async function mailpit(path: string, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`${MAILPIT_URL}${path}`, init)
  } catch (cause) {
    throw new Error(`Could not reach the test mailbox at ${MAILPIT_URL}. Is Supabase running?`, {
      cause,
    })
  }
  if (!response.ok) {
    throw new Error(`Test mailbox answered ${response.status} for ${path}`)
  }
  return response
}

/** Mailpit search for mail addressed to exactly this address. Newest first. */
function toQuery(address: string): string {
  return `query=${encodeURIComponent(`to:"${address}"`)}`
}

async function listMessages(address: string): Promise<MailpitSummary[]> {
  const response = await mailpit(`/api/v1/search?${toQuery(address)}&limit=50`)
  const result = (await response.json()) as { messages: MailpitSummary[] }
  return [...result.messages].sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created))
}

function parseSignInEmail(
  address: string,
  summary: MailpitSummary,
  message: MailpitBody,
): SignInEmail {
  // The plain-text part has the link unescaped; fall back to the HTML href.
  const link =
    /https?:\/\/[^\s<>"')]+\/auth\/confirm\?[^\s<>"')]+/.exec(message.Text)?.[0] ??
    /href="([^"]+\/auth\/confirm\?[^"]+)"/.exec(message.HTML)?.[1].replaceAll('&amp;', '&')
  // The code sits on a line of its own, so the digits inside the link can't match.
  const code =
    /^\s*(\d{6})\s*$/m.exec(message.Text)?.[1] ?? />\s*(\d{6})\s*</.exec(message.HTML)?.[1]

  if (!link || !code) {
    throw new Error(
      `The sign-in email to ${address} is missing its ${!link ? 'link' : 'code'}.\n` +
        `Subject: ${summary.Subject}\n${message.Text}`,
    )
  }
  return {
    id: summary.ID,
    to: address,
    subject: summary.Subject,
    receivedAt: new Date(summary.Created),
    link,
    code,
  }
}

export interface WaitForEmailOptions {
  /** Only accept an email that is not this one and not older than it: use it to wait for a resend. */
  after?: SignInEmail
  /** How long to keep checking, in milliseconds. */
  timeoutMs?: number
}

/**
 * Wait for the newest sign-in email sent to `address` and return its link and
 * code. Checks the mailbox repeatedly until the email arrives or time runs out.
 */
export async function waitForSignInEmail(
  address: string,
  { after, timeoutMs = 15_000 }: WaitForEmailOptions = {},
): Promise<SignInEmail> {
  const deadline = Date.now() + timeoutMs
  let delay = 100

  for (;;) {
    const newest = (await listMessages(address)).find(
      (message) =>
        !after ||
        (message.ID !== after.id && Date.parse(message.Created) >= after.receivedAt.getTime()),
    )
    if (newest) {
      const response = await mailpit(`/api/v1/message/${newest.ID}`)
      return parseSignInEmail(address, newest, (await response.json()) as MailpitBody)
    }
    if (Date.now() + delay > deadline) {
      throw new Error(
        `No ${after ? 'new ' : ''}sign-in email for ${address} arrived within ${timeoutMs}ms.`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, 1_000)
  }
}

/** How many emails the mailbox holds for `address`. */
export async function countEmails(address: string): Promise<number> {
  return (await listMessages(address)).length
}

/** Remove every email sent to `address`, so test runs do not pile up in the mailbox. */
export async function deleteEmails(address: string): Promise<void> {
  await mailpit(`/api/v1/search?${toQuery(address)}`, { method: 'DELETE' })
}
