import 'server-only'

import { createHash, createPublicKey, verify } from 'node:crypto'
import { classifyFalError, falImageUrl } from './fal'
import type { JobState } from './types'

/**
 * fal webhook verification. fal signs each delivery with Ed25519:
 *   message   = request id + "\n" + user id + "\n" + timestamp + "\n" + sha256hex(raw body)
 *   signature = hex, in X-Fal-Webhook-Signature
 *   keys      = https://rest.fal.ai/.well-known/jwks.json (cache at most 24h)
 * A delivery is accepted when any published key verifies it and the timestamp
 * is within five minutes.
 */

export const FAL_JWKS_URL = 'https://rest.fal.ai/.well-known/jwks.json'
const KEY_CACHE_MS = 60 * 60 * 1000
const MAX_SKEW_SECONDS = 300

interface Jwk {
  kty: string
  crv?: string
  x?: string
}

let cachedKeys: { at: number; keys: Jwk[] } | null = null

async function fetchKeys(): Promise<Jwk[]> {
  if (cachedKeys && Date.now() - cachedKeys.at < KEY_CACHE_MS) return cachedKeys.keys
  const response = await fetch(FAL_JWKS_URL, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`Could not fetch fal webhook keys: HTTP ${response.status}`)
  const body = (await response.json()) as { keys?: Jwk[] }
  const keys = (body.keys ?? []).filter(
    (key) => key.kty === 'OKP' && key.crv === 'Ed25519' && key.x,
  )
  cachedKeys = { at: Date.now(), keys }
  return keys
}

export interface WebhookHeaders {
  requestId: string | null
  userId: string | null
  timestamp: string | null
  signature: string | null
}

export function webhookHeaders(headers: Headers): WebhookHeaders {
  return {
    requestId: headers.get('x-fal-webhook-request-id'),
    userId: headers.get('x-fal-webhook-user-id'),
    timestamp: headers.get('x-fal-webhook-timestamp'),
    signature: headers.get('x-fal-webhook-signature'),
  }
}

/**
 * True when the delivery is genuinely from fal. `getKeys` and `now` are
 * injectable for tests.
 */
export async function verifyFalWebhook(
  rawBody: Buffer,
  h: WebhookHeaders,
  getKeys: () => Promise<Jwk[]> = fetchKeys,
  now: () => number = Date.now,
): Promise<boolean> {
  if (!h.requestId || !h.userId || !h.timestamp || !h.signature) return false
  if (!/^\d+$/.test(h.timestamp) || !/^[0-9a-f]+$/i.test(h.signature)) return false
  if (Math.abs(now() / 1000 - Number(h.timestamp)) > MAX_SKEW_SECONDS) return false

  const bodyHash = createHash('sha256').update(rawBody).digest('hex')
  const message = Buffer.from([h.requestId, h.userId, h.timestamp, bodyHash].join('\n'), 'utf8')
  const signature = Buffer.from(h.signature, 'hex')

  for (const key of await getKeys()) {
    try {
      const publicKey = createPublicKey({
        key: { kty: 'OKP', crv: 'Ed25519', x: key.x!.replace(/=+$/, '') },
        format: 'jwk',
      })
      if (verify(null, message, publicKey, signature)) return true
    } catch {
      // A malformed key or signature is simply not a match.
    }
  }
  return false
}

/** Turn a verified webhook body into a job state. */
export function parseFalWebhook(body: unknown): { requestId: string; state: JobState } | null {
  const record = (body ?? {}) as Record<string, unknown>
  if (typeof record.request_id !== 'string') return null
  if (record.status === 'OK') {
    const imageUrl = falImageUrl(record.payload)
    return {
      requestId: record.request_id,
      state: imageUrl
        ? { state: 'succeeded', imageUrl }
        : {
            state: 'failed',
            code: 'no_image',
            message: 'The model returned no image.',
            retryable: true,
          },
    }
  }
  return { requestId: record.request_id, state: classifyFalError(record.payload) }
}
