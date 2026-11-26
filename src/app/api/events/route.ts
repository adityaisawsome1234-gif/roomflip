import { z } from 'zod'
import { track } from '@/lib/analytics'
import { apiUser, json, jsonError } from '@/lib/api'
import { limitRequest } from '@/lib/rate-limit'

/** Events only the browser can see. Everything else is reported by the server itself. */
const bodySchema = z
  .object({
    event: z.literal('paywall_view'),
    properties: z.object({ reason: z.enum(['after_result', 'credits', 'hd']) }).strict(),
  })
  .strict()

export async function POST(request: Request) {
  const user = await apiUser()
  if (user instanceof Response) return user
  const limited = await limitRequest('events', request, user.id)
  if (limited) return limited

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return jsonError(400, 'invalid_request', 'Unknown event.')
  await track(parsed.data.event, user.id, parsed.data.properties)
  return json({ ok: true }, 202)
}
