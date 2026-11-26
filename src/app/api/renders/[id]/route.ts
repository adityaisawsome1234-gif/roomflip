import { apiUser, json, jsonError } from '@/lib/api'
import { getRenderView } from '@/lib/render/jobs'

export const maxDuration = 30

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A render's status, and its images once finished. Polling this also moves
 * the job along: it checks the provider, finishes a completed job, retries or
 * refunds a failed one, and times out one past its deadline.
 */
export async function GET(_request: Request, ctx: RouteContext<'/api/renders/[id]'>) {
  const user = await apiUser()
  if (user instanceof Response) return user

  const { id } = await ctx.params
  if (!UUID.test(id)) return jsonError(404, 'not_found', 'Render not found.')

  try {
    const render = await getRenderView(user.id, id)
    return render ? json({ render }) : jsonError(404, 'not_found', 'Render not found.')
  } catch (error) {
    console.error('[renders] status failed:', (error as Error).message)
    return jsonError(500, 'server_error', 'Something went wrong. Try again.')
  }
}
