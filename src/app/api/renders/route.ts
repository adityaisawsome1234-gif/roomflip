import { after } from 'next/server'
import { apiUser, json, jsonError } from '@/lib/api'
import { failStaleRenders } from '@/lib/credits/ledger'
import { RenderError, requestRender } from '@/lib/render/jobs'
import { renderRequestSchema } from '@/lib/render/request'

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
    return json(result, result.created ? 202 : 200)
  } catch (error) {
    if (error instanceof RenderError) return jsonError(error.status, error.code, error.message)
    console.error('[renders] start failed:', (error as Error).message)
    return jsonError(500, 'server_error', 'Something went wrong. Try again.')
  }
}
