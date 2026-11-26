import { z } from 'zod'
import { apiUser, json, jsonError } from '@/lib/api'
import { createAdminClient } from '@/lib/supabase/admin'

const bodySchema = z.object({ saved: z.boolean() }).strict()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Save a finished render to My Rooms, or remove it. Body: { saved: boolean }. */
export async function POST(request: Request, ctx: RouteContext<'/api/renders/[id]/save'>) {
  const user = await apiUser()
  if (user instanceof Response) return user
  const { id } = await ctx.params
  if (!UUID.test(id)) return jsonError(404, 'not_found', 'Render not found.')

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return jsonError(400, 'invalid_request', 'Send { saved: true | false }.')

  const { data } = await createAdminClient()
    .from('renders')
    .update({ is_saved: parsed.data.saved })
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('status', 'succeeded')
    .select('id, is_saved')
  if (!data?.length) return jsonError(404, 'not_found', 'Render not found.')
  return json({ saved: data[0].is_saved })
}
