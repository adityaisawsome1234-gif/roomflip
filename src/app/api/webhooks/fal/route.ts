import { handleProviderResult } from '@/lib/render/jobs'
import {
  parseFalWebhook,
  verifyFalWebhook,
  webhookHeaders,
} from '@/lib/render/providers/fal-webhook'

export const maxDuration = 60

/**
 * fal calls this when a queued job finishes. The signature is checked before
 * anything else. Unknown request ids get a 200 so fal stops retrying; real
 * processing errors get a 500 so fal retries later.
 */
export async function POST(request: Request) {
  const raw = Buffer.from(await request.arrayBuffer())
  const headers = webhookHeaders(request.headers)
  if (!(await verifyFalWebhook(raw, headers))) {
    return new Response('invalid signature', { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(raw.toString('utf8'))
  } catch {
    return new Response('invalid body', { status: 400 })
  }
  const event = parseFalWebhook(body)
  if (!event) return new Response('ignored', { status: 200 })
  // The signature covers the header's request id; the body must be about the same request.
  if (event.requestId !== headers.requestId) {
    return new Response('request id mismatch', { status: 400 })
  }

  try {
    await handleProviderResult('fal', event.requestId, event.state)
    return new Response('ok', { status: 200 })
  } catch (error) {
    console.error('[webhooks/fal] processing failed:', (error as Error).message)
    return new Response('error', { status: 500 })
  }
}
