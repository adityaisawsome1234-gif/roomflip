import { z } from 'zod'
import { trackLater } from '@/lib/analytics'
import { apiUser, json, jsonError } from '@/lib/api'
import { limitRequest } from '@/lib/rate-limit'
import { ExportError, getOrCreateExport } from '@/lib/export/service'

// Encoding a reel takes a few seconds; allow for a cold start as well.
export const maxDuration = 60

const bodySchema = z.object({ kind: z.enum(['reel', 'square']) }).strict()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Make (or fetch) the shareable export of a finished render.
 * Body: { kind: 'reel' | 'square' }. Returns signed URLs to view and download it.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/renders/[id]/export'>) {
  const user = await apiUser()
  if (user instanceof Response) return user
  const limited = await limitRequest('export', request, user.id)
  if (limited) return limited
  const { id } = await ctx.params
  if (!UUID.test(id)) return jsonError(404, 'not_found', 'Render not found.')

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return jsonError(400, 'invalid_request', "Send { kind: 'reel' | 'square' }.")

  try {
    const file = await getOrCreateExport(user.id, id, parsed.data.kind)
    if (file.kind === 'reel') {
      trackLater('export_reel', user.id, {
        render_id: id,
        watermarked: file.watermarked,
        width: file.width,
      })
    }
    return json({ export: file })
  } catch (error) {
    if (error instanceof ExportError) return jsonError(error.status, error.code, error.message)
    console.error('[export] failed:', (error as Error).message)
    return jsonError(500, 'server_error', "We couldn't make that file. Try again.")
  }
}
