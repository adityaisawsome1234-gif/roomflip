import 'server-only'

import { ENTITLEMENTS } from '@/lib/config/pricing'
import { getEntitlement } from '@/lib/credits/entitlement'
import { createAdminClient } from '@/lib/supabase/admin'
import { BUCKETS, getObject, putObject, userPath } from '@/lib/storage'
import { reelCaption } from './caption'
import { renderReel, renderSquare } from './render'

export type ExportKind = 'reel' | 'square'

export class ExportError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ExportError'
  }
}

export interface ExportView {
  kind: ExportKind
  /** For showing in the page. */
  url: string
  /** Same file, served as a download with a friendly name. */
  downloadUrl: string
  filename: string
  mimeType: string
  width: number
  height: number
  durationMs: number | null
  watermarked: boolean
}

const URL_TTL_SECONDS = 60 * 60

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'room'
  )
}

/**
 * The reel or square image for a finished render, made on first request and
 * reused after that. Free users get the watermarked variant; paid users the
 * clean, larger one.
 */
export async function getOrCreateExport(
  userId: string,
  renderId: string,
  kind: ExportKind,
): Promise<ExportView> {
  const db = createAdminClient()
  const { data: render } = await db
    .from('renders')
    .select('id, room_id, mode, params, status, result_path, created_at, completed_at')
    .eq('id', renderId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!render) throw new ExportError(404, 'not_found', 'Render not found.')
  if (render.status !== 'succeeded' || !render.result_path) {
    throw new ExportError(409, 'not_ready', 'This render is not finished yet.')
  }

  const variant = await getEntitlement(userId)
  const watermarked = variant === 'free'
  const caption = await (async () => {
    const { data: room } = await db
      .from('rooms')
      .select('room_type, original_path')
      .eq('id', render.room_id)
      .maybeSingle()
    if (!room) throw new ExportError(404, 'not_found', 'Room not found.')
    const seconds =
      render.completed_at && render.created_at
        ? (new Date(render.completed_at).getTime() - new Date(render.created_at).getTime()) / 1000
        : null
    return {
      originalPath: room.original_path,
      text: reelCaption({
        roomType: room.room_type,
        mode: render.mode,
        params: render.params as Record<string, unknown>,
        seconds,
      }),
    }
  })()

  const ext = kind === 'reel' ? 'mp4' : 'jpg'
  const mimeType = kind === 'reel' ? 'video/mp4' : 'image/jpeg'
  const filename = `roomflip-${slug(caption.text.look)}-${kind === 'reel' ? 'reel' : 'before-after'}.${ext}`

  let row = (
    await db
      .from('exports')
      .select('path, width, height, duration_ms')
      .eq('render_id', renderId)
      .eq('kind', kind)
      .eq('variant', variant)
      .maybeSingle()
  ).data

  if (!row) {
    const [before, after] = await Promise.all([
      getObject({ bucket: BUCKETS.originals, path: caption.originalPath }),
      getObject({ bucket: BUCKETS.renders, path: render.result_path }),
    ])
    const limits = ENTITLEMENTS[variant]
    const made =
      kind === 'reel'
        ? await renderReel({
            before,
            after,
            caption: caption.text,
            width: limits.reel.width,
            height: limits.reel.height,
            watermark: watermarked,
          })
        : {
            ...(await renderSquare({
              before,
              after,
              size: Math.min(1080, limits.maxImageEdgePx),
              watermark: watermarked,
            })),
            durationMs: null,
          }

    const path = userPath(userId, `${renderId}-${kind}-${variant}.${ext}`)
    await putObject({ bucket: BUCKETS.exports, path }, made.data, mimeType)
    // Two requests can race to make the same export; both files are identical,
    // and the unique key keeps one row.
    await db.from('exports').upsert(
      {
        user_id: userId,
        render_id: renderId,
        kind,
        variant,
        path,
        bytes: made.data.byteLength,
        width: made.width,
        height: made.height,
        duration_ms: made.durationMs,
      },
      { onConflict: 'render_id,kind,variant', ignoreDuplicates: true },
    )
    row = { path, width: made.width, height: made.height, duration_ms: made.durationMs }
  }

  const bucket = createAdminClient().storage.from(BUCKETS.exports)
  const [view, download] = await Promise.all([
    bucket.createSignedUrl(row.path, URL_TTL_SECONDS),
    bucket.createSignedUrl(row.path, URL_TTL_SECONDS, { download: filename }),
  ])
  if (!view.data || !download.data) throw new Error('Could not sign the export URL')

  return {
    kind,
    url: view.data.signedUrl,
    downloadUrl: download.data.signedUrl,
    filename,
    mimeType,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    watermarked,
  }
}
