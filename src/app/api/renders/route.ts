import { after } from 'next/server'
import { trackLater } from '@/lib/analytics'
import { apiUser, json, jsonError } from '@/lib/api'
import { failStaleRenders } from '@/lib/credits/ledger'
import { RenderError, requestRender } from '@/lib/render/jobs'
import { renderRequestSchema } from '@/lib/render/request'
import { limitRequest } from '@/lib/rate-limit'

export const maxDuration = 60

/**
 * Start a render. JSON body, see renderRequestSchema:
 *   { tier: 'preview', roomId, choice, clientRequestId? }
 *   { tier: 'hd', sourceRenderId, clientRequestId? }
 * Returns 202 with the render id; poll GET /api/renders/{id} for progress.
 */
export async function POST(request: Request) {
  const user = await apiUser()
  if (user instanceof Response) return user
  const limited = await limitRequest('render', request, user.id)
  if (limited) return limited

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, 'bad_request', 'Send a JSON body.')
  }
  const parsed = renderRequestSchema.safeParse(body)
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', 'That request is not valid.')
  }

  // Tidy up abandoned jobs (refunding them) after the response is sent.
  after(async () => {
    try {
      await failStaleRenders(25)
    } catch (error) {
      console.error('[renders] stale sweep failed:', (error as Error).message)
    }
  })

  try {
    const result = await requestRender(user.id, parsed.data)
    if (result.created) {
      trackLater('render_started', user.id, {
        render_id: result.renderId,
        tier: parsed.data.tier,
        mode: parsed.data.tier === 'preview' ? parsed.data.choice.mode : null,
        credits_left: result.balance,
      })
    }
    return json(result, result.created ? 202 : 200)
  } catch (error) {
    if (error instanceof RenderError) return jsonError(error.status, error.code, error.message)
    console.error('[renders] start failed:', (error as Error).message)
    return jsonError(500, 'server_error', 'Something went wrong. Try again.')
  }
}
