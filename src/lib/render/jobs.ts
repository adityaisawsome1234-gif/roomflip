import 'server-only'

import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { getModel, isModelId, resolveTierModel, type ModelSpec } from '@/lib/config/models'
import { ENTITLEMENTS, type RenderTier } from '@/lib/config/pricing'
import { getEntitlement } from '@/lib/credits/entitlement'
import { CreditsError, completeRender, failRender, startRender } from '@/lib/credits/ledger'
import { publicEnv } from '@/lib/env'
import { optionalServerEnv } from '@/lib/env.server'
import { addWatermark } from '@/lib/images/watermark'
import { BUCKETS, putObject, removeObjects, signedUrl, userPath, type Bucket } from '@/lib/storage'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database, Json } from '@/lib/supabase/database.types'
import { buildPrompt, type ImageRole, type RestyleSpec } from './prompt'
import { getProvider, ProviderError, type JobState } from './providers'
import { sizeRequest, type SizeRequest } from './providers/sizing'
import type { RenderRequest, RestyleChoice } from './request'

/**
 * The render job runner.
 *
 *   requestRender   validate, build the prompt, take the credit, submit
 *   refreshRender   ask the provider how a job is doing (status polling)
 *   applyJobState   act on an answer, from a poll or a webhook:
 *                   finalize, retry once, or fail and refund
 *
 * Credits are taken in the same transaction that creates the render row, and
 * every failure path ends in failRender, which refunds exactly once.
 */

type RenderRow = Database['public']['Tables']['renders']['Row']

/** Attempts per render, counting the first. One automatic retry. */
const MAX_ATTEMPTS = 2
/** A retry is only worth starting if this much time is left before the deadline. */
const MIN_SECONDS_FOR_RETRY = 45
/**
 * A submission claim older than this is presumed dead (its request crashed),
 * so another caller may take over. Longer than the longest possible submit.
 */
const SUBMIT_CLAIM_STALE_SECONDS = 60
/** How long the provider has to fetch the input images. Longer than any deadline. */
const INPUT_URL_TTL_SECONDS = 60 * 60
/** Polling the provider more often than this does not help. */
const CHECK_INTERVAL_MS = 2_000
/** Largest result image accepted from a provider. */
const RESULT_MAX_BYTES = 30_000_000
/** Signed URLs handed to the browser. */
const VIEW_URL_TTL_SECONDS = 60 * 60

export class RenderError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RenderError'
  }
}

interface JobInput {
  images: { bucket: Bucket; path: string; role: ImageRole }[]
  size: SizeRequest
}

/** What is stored in renders.params (visible to the owner). */
type StoredParams =
  | { preset: string }
  | { custom: string }
  | {
      paintColorId: number
      surfaces: string[]
      color: { brand: string; name: string; code: string; hex: string }
    }
  | { swatchId: string; target: string }

/**
 * The model for a tier. Without a fal key, local development falls back to
 * the mock model so the app still works end to end; production refuses.
 */
export function resolveRenderModel(tier: RenderTier): ModelSpec {
  const model = resolveTierModel(
    tier,
    optionalServerEnv(tier === 'preview' ? 'RENDER_MODEL_PREVIEW' : 'RENDER_MODEL_HD'),
  )
  if (model.provider === 'fal' && !optionalServerEnv('FAL_KEY')) {
    if (process.env.NODE_ENV === 'production') {
      throw new RenderError(503, 'not_configured', 'Image generation is not configured.')
    }
    return getModel('mock')
  }
  return model
}

function webhookUrl(): string | undefined {
  const site = publicEnv.siteUrl
  // fal cannot reach a private address, and drops such webhooks anyway.
  if (!site.startsWith('https://') || /\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(site)) {
    return undefined
  }
  return `${site}/api/webhooks/fal`
}

function specFromParams(mode: string, params: Json): RestyleSpec {
  const p = (params ?? {}) as Record<string, unknown>
  if (mode === 'style' && typeof p.preset === 'string') {
    return { mode: 'style', preset: p.preset as never }
  }
  if (mode === 'style' && typeof p.custom === 'string') return { mode: 'style', custom: p.custom }
  if (mode === 'paint') {
    return { mode: 'paint', color: p.color as never, surfaces: p.surfaces as never }
  }
  if (mode === 'material') return { mode: 'material', target: p.target as never }
  throw new RenderError(409, 'bad_source', 'The source render cannot be reused.')
}

/** Resolve a browser's choice into a prompt spec, stored params and any extra input image. */
async function resolveChoice(
  userId: string,
  choice: RestyleChoice,
): Promise<{ spec: RestyleSpec; params: StoredParams; swatchPath?: string }> {
  const db = createAdminClient()
  switch (choice.mode) {
    case 'style':
      return 'preset' in choice
        ? { spec: choice, params: { preset: choice.preset } }
        : { spec: choice, params: { custom: choice.custom } }
    case 'paint': {
      const { data: color } = await db
        .from('paint_colors')
        .select('brand, name, code, hex')
        .eq('id', choice.paintColorId)
        .eq('is_active', true)
        .maybeSingle()
      if (!color) throw new RenderError(400, 'unknown_color', 'That paint colour is not available.')
      return {
        spec: { mode: 'paint', color, surfaces: choice.surfaces },
        params: { paintColorId: choice.paintColorId, surfaces: choice.surfaces, color },
      }
    }
    case 'material': {
      const { data: swatch } = await db
        .from('swatches')
        .select('path')
        .eq('id', choice.swatchId)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .maybeSingle()
      if (!swatch)
        throw new RenderError(404, 'swatch_not_found', 'That sample photo was not found.')
      return {
        spec: { mode: 'material', target: choice.target },
        params: { swatchId: choice.swatchId, target: choice.target },
        swatchPath: swatch.path,
      }
    }
  }
}

/** Start a render: validate, take the credit, and hand it to the provider. */
export async function requestRender(
  userId: string,
  request: RenderRequest,
): Promise<{ renderId: string; created: boolean; balance: number }> {
  const db = createAdminClient()
  const model = resolveRenderModel(request.tier)

  let roomId: string
  let spec: RestyleSpec
  let mode: RestyleSpec['mode']
  let params: StoredParams | Json
  const extra: { swatch?: string; preview?: string } = {}

  if (request.tier === 'preview') {
    roomId = request.roomId
    const resolved = await resolveChoice(userId, request.choice)
    spec = resolved.spec
    mode = spec.mode
    params = resolved.params
    extra.swatch = resolved.swatchPath
  } else {
    if ((await getEntitlement(userId)) !== 'paid') {
      throw new RenderError(403, 'upgrade_required', 'HD finals are part of Pro.')
    }
    const { data: source } = await db
      .from('renders')
      .select('room_id, tier, status, mode, params, result_path')
      .eq('id', request.sourceRenderId)
      .eq('user_id', userId)
      .maybeSingle()
    if (!source) throw new RenderError(404, 'render_not_found', 'That render was not found.')
    if (source.tier !== 'preview' || source.status !== 'succeeded' || !source.result_path) {
      throw new RenderError(409, 'source_not_ready', 'That render is not finished yet.')
    }
    roomId = source.room_id
    mode = source.mode as RestyleSpec['mode']
    spec = specFromParams(source.mode, source.params)
    params = source.params
    extra.preview = source.result_path
    if (spec.mode === 'material') {
      const swatchId = (source.params as { swatchId?: string }).swatchId
      const { data: swatch } = await db
        .from('swatches')
        .select('path')
        .eq('id', swatchId ?? '')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .maybeSingle()
      if (!swatch)
        throw new RenderError(404, 'swatch_not_found', 'That sample photo was not found.')
      extra.swatch = swatch.path
    }
  }

  const { data: room } = await db
    .from('rooms')
    .select('original_path, width, height, room_type')
    .eq('id', roomId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!room) throw new RenderError(404, 'room_not_found', 'That room was not found.')

  const built = buildPrompt({ spec, tier: request.tier, roomType: room.room_type })
  const pathFor: Record<ImageRole, { bucket: Bucket; path: string } | undefined> = {
    room: { bucket: BUCKETS.originals, path: room.original_path },
    preview: extra.preview ? { bucket: BUCKETS.renders, path: extra.preview } : undefined,
    swatch: extra.swatch ? { bucket: BUCKETS.swatches, path: extra.swatch } : undefined,
  }
  const jobInput: JobInput = {
    images: built.images.map((role) => {
      const object = pathFor[role]
      if (!object) throw new RenderError(500, 'missing_input', `Missing ${role} image.`)
      return { ...object, role }
    }),
    size: sizeRequest(model.sizing, room.width, room.height, request.tier),
  }

  let started
  try {
    started = await startRender({
      userId,
      roomId,
      tier: request.tier,
      mode,
      params: params as Record<string, unknown>,
      prompt: built.prompt,
      model,
      inputImages: jobInput.images.length,
      sourceRenderId: request.tier === 'hd' ? request.sourceRenderId : undefined,
      clientRequestId: request.clientRequestId,
    })
  } catch (error) {
    if (error instanceof CreditsError) {
      if (error.reason === 'insufficient_credits') {
        throw new RenderError(402, 'insufficient_credits', 'You are out of renders.')
      }
      if (error.reason === 'not_found') throw new RenderError(404, 'not_found', 'Not found.')
      if (error.reason === 'conflict') throw new RenderError(409, 'conflict', error.message)
    }
    throw error
  }

  // A repeat of an accepted request: that job is already on its way.
  if (!started.created) return started

  await db
    .from('renders')
    .update({ job_input: jobInput as unknown as Json })
    .eq('id', started.renderId)

  // Claim the first submission, so a poll or the sweeper cannot submit it too.
  if (!(await claimSubmission(started.renderId, null))) return started
  const { data: row } = await db.from('renders').select('*').eq('id', started.renderId).single()
  try {
    await submitWithRetry(row!)
  } catch (error) {
    const result = await failRender(started.renderId, 'submit_failed', (error as Error).message)
    throw new RenderError(
      502,
      'submit_failed',
      `We could not start the render. ${result.refunded > 0 ? 'Your credit was refunded.' : ''}`.trim(),
    )
  }
  return started
}

/** Send a render to its provider; on a retryable error, try once more straight away. */
async function submitWithRetry(render: RenderRow): Promise<void> {
  try {
    await submit(render)
  } catch (error) {
    if (error instanceof ProviderError && error.retryable) {
      await new Promise((resolve) => setTimeout(resolve, 750))
      await submit(render)
      return
    }
    throw error
  }
}

async function submit(render: RenderRow): Promise<void> {
  if (!isModelId(render.model)) throw new ProviderError(`Unknown model ${render.model}`, false)
  const model = getModel(render.model)
  const input = render.job_input as unknown as JobInput | null
  if (!input) throw new ProviderError('Render has no job input', false)

  const imageUrls = await Promise.all(
    input.images.map((image) => signedUrl(image, INPUT_URL_TTL_SECONDS)),
  )
  const submitted = await getProvider(model.provider).submit(
    model,
    { prompt: render.prompt, imageUrls, size: input.size },
    { webhookUrl: webhookUrl() },
  )
  const { error } = await createAdminClient().rpc('mark_render_submitted', {
    p_render_id: render.id,
    p_provider_request_id: submitted.requestId,
    p_provider_endpoint: submitted.endpoint,
  })
  if (error) throw new Error(`Could not record submission: ${error.message}`)
}

/**
 * Where a provider's result image may be downloaded from. The URL comes from
 * the provider's response or a signed webhook, but the server still refuses to
 * fetch anything else, so a bad response can never point it at an internal
 * address.
 */
const RESULT_HOSTS = ['fal.media', 'fal.ai', 'fal.run', 'storage.googleapis.com']

export function isAllowedResultUrl(url: string): boolean {
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(url)) return true
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' &&
      RESULT_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))
    )
  } catch {
    return false
  }
}

/** Fetch the result image, from a URL or a data URI. */
async function downloadResult(url: string): Promise<Buffer> {
  if (!isAllowedResultUrl(url)) {
    throw new Error(
      `Result host not allowed: ${URL.canParse(url) ? new URL(url).hostname : 'invalid'}`,
    )
  }
  if (url.startsWith('data:')) {
    const match = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i.exec(url)
    if (!match) throw new Error('Malformed data URI result')
    return Buffer.from(match[1], 'base64')
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'error' })
  if (!response.ok) throw new Error(`Result download failed: HTTP ${response.status}`)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > RESULT_MAX_BYTES) throw new Error('Result image is too large')
  const data = Buffer.from(await response.arrayBuffer())
  if (data.byteLength > RESULT_MAX_BYTES) throw new Error('Result image is too large')
  return data
}

/** Store the result (clean master and watermarked copy) and mark the render done. */
async function finalize(render: RenderRow, imageUrl: string): Promise<void> {
  const raw = await downloadResult(imageUrl)
  const { data: clean, info } = await sharp(raw, { limitInputPixels: 40_000_000 })
    .rotate()
    .toColourspace('srgb')
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })

  const freeEdge = ENTITLEMENTS.free.maxImageEdgePx
  const watermarked = await addWatermark(
    await sharp(clean)
      .resize({ width: freeEdge, height: freeEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer(),
  )

  // Names unique to this finish attempt: a second delivery of the same result
  // (poll and webhook at once) writes its own files and never touches these.
  const suffix = randomUUID().slice(0, 8)
  const resultPath = userPath(render.user_id, `${render.id}-${suffix}.jpg`)
  const watermarkedPath = userPath(render.user_id, `${render.id}-${suffix}-wm.jpg`)
  await putObject({ bucket: BUCKETS.renders, path: resultPath }, clean, 'image/jpeg')
  await putObject({ bucket: BUCKETS.renders, path: watermarkedPath }, watermarked, 'image/jpeg')

  const accepted = await completeRender({
    renderId: render.id,
    resultPath,
    watermarkedPath,
    width: info.width,
    height: info.height,
  })
  // Not accepted: the render timed out (and was refunded) while this result
  // was on its way, or another delivery finished it first. Either way these
  // files are not the render's result and are safe to remove.
  if (!accepted) await removeObjects(BUCKETS.renders, [resultPath, watermarkedPath])
}

/** Act on what the provider says about a job. Safe to call repeatedly and concurrently. */
export async function applyJobState(render: RenderRow, state: JobState): Promise<void> {
  if (render.status !== 'queued' && render.status !== 'processing') return

  if (state.state === 'pending') return

  if (state.state === 'succeeded') {
    try {
      await finalize(render, state.imageUrl)
    } catch (error) {
      await retryOrFail(render, {
        state: 'failed',
        code: 'result_unusable',
        message: (error as Error).message,
        retryable: true,
      })
    }
    return
  }

  await retryOrFail(render, state)
}

async function retryOrFail(render: RenderRow, failure: JobState & { state: 'failed' }) {
  const secondsLeft = render.deadline_at
    ? (new Date(render.deadline_at).getTime() - Date.now()) / 1000
    : 0
  const eligible =
    failure.retryable && render.attempts < MAX_ATTEMPTS && secondsLeft > MIN_SECONDS_FOR_RETRY

  if (eligible) {
    // A poll, a webhook and the sweeper can all get here for the same failed
    // attempt. Only the caller that wins the claim resubmits; the others stop.
    if (!(await claimSubmission(render.id, render.provider_request_id))) return
    try {
      await submit(render)
      return
    } catch {
      // Fall through to failing the render.
    }
  }
  await failRender(render.id, failure.code, failure.message)
}

/**
 * Take the right to submit a render to its provider (see
 * claim_render_submission in the pipeline hardening migration). Pass the
 * provider request id being replaced, or null when there is none yet.
 */
async function claimSubmission(renderId: string, replacing: string | null): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc('claim_render_submission', {
    p_render_id: renderId,
    p_expected_request_id: replacing as string,
    p_stale_seconds: SUBMIT_CLAIM_STALE_SECONDS,
    p_max_attempts: MAX_ATTEMPTS,
  })
  if (error) throw new Error(`Could not claim render submission: ${error.message}`)
  return data === true
}

async function loadRender(renderId: string): Promise<RenderRow | null> {
  const { data } = await createAdminClient()
    .from('renders')
    .select('*')
    .eq('id', renderId)
    .maybeSingle()
  return data
}

/**
 * Bring an in-flight render up to date: time it out if its deadline has
 * passed, otherwise ask the provider (at most every couple of seconds).
 */
export async function refreshRender(renderId: string): Promise<void> {
  const render = await loadRender(renderId)
  if (!render || (render.status !== 'queued' && render.status !== 'processing')) return

  if (render.deadline_at && new Date(render.deadline_at).getTime() <= Date.now()) {
    await failRender(render.id, 'timeout', 'The render did not finish in time.')
    return
  }

  // Never handed to the provider (the request that created it died, or a
  // resubmission is under way): the claim decides whether to submit it now.
  if (!render.provider_request_id || !render.provider_endpoint) {
    // Still being set up by the request that created it; the deadline covers a crash.
    if (!render.job_input) return
    await retryOrFail(render, {
      state: 'failed',
      code: 'submit_failed',
      message: 'Render was never submitted.',
      retryable: true,
    })
    return
  }

  // Concurrent pollers of the same render ask the provider at most once per interval.
  const { data: due } = await createAdminClient().rpc('claim_render_check', {
    p_render_id: render.id,
    p_request_id: render.provider_request_id,
    p_interval_ms: CHECK_INTERVAL_MS,
  })
  if (due !== true) return

  const state = await getProvider(render.provider).check(
    render.provider_endpoint,
    render.provider_request_id,
  )
  await applyJobState(render, state)
}

/** Handle a provider callback for one of our jobs. Unknown ids are ignored. */
export async function handleProviderResult(
  provider: string,
  requestId: string,
  state: JobState,
): Promise<'applied' | 'unknown'> {
  const { data: render } = await createAdminClient()
    .from('renders')
    .select('*')
    .eq('provider', provider)
    .eq('provider_request_id', requestId)
    .maybeSingle()
  if (!render) return 'unknown'
  await applyJobState(render, state)
  return 'applied'
}

/** Refresh in-flight renders nobody has asked about recently (lost webhooks, closed tabs). */
export async function refreshNeglectedRenders(limit = 50): Promise<number> {
  const cutoff = new Date(Date.now() - 60_000).toISOString()
  const { data } = await createAdminClient()
    .from('renders')
    .select('id')
    .in('status', ['queued', 'processing'])
    .or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`)
    .order('created_at')
    .limit(limit)
  for (const { id } of data ?? []) {
    try {
      await refreshRender(id)
    } catch (error) {
      console.error('[render] refresh failed', id, (error as Error).message)
    }
  }
  return data?.length ?? 0
}

export interface RenderView {
  id: string
  roomId: string
  tier: string
  mode: string
  params: Json
  status: 'queued' | 'processing' | 'succeeded' | 'failed'
  errorCode: string | null
  sourceRenderId: string | null
  isSaved: boolean
  createdAt: string
  completedAt: string | null
  before: { url: string; width: number; height: number }
  after: { url: string; width: number; height: number; watermarked: boolean } | null
}

/** A render as its owner sees it, with fresh signed image URLs. Refreshes it first if in flight. */
export async function getRenderView(userId: string, renderId: string): Promise<RenderView | null> {
  const db = createAdminClient()
  const owned = await db
    .from('renders')
    .select('id, status')
    .eq('id', renderId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!owned.data) return null
  if (owned.data.status === 'queued' || owned.data.status === 'processing') {
    await refreshRender(renderId)
  }

  const render = await loadRender(renderId)
  if (!render) return null
  const { data: room } = await db
    .from('rooms')
    .select('original_path, width, height')
    .eq('id', render.room_id)
    .maybeSingle()
  if (!room) return null

  let after: RenderView['after'] = null
  if (render.status === 'succeeded' && render.result_path) {
    const paid = (await getEntitlement(userId)) === 'paid'
    const useClean = paid || !render.watermarked_path
    const path = useClean ? render.result_path : render.watermarked_path!
    const scale = useClean
      ? 1
      : Math.min(
          1,
          ENTITLEMENTS.free.maxImageEdgePx /
            Math.max(render.result_width ?? 1, render.result_height ?? 1),
        )
    after = {
      url: await signedUrl({ bucket: BUCKETS.renders, path }, VIEW_URL_TTL_SECONDS),
      width: Math.round((render.result_width ?? 0) * scale),
      height: Math.round((render.result_height ?? 0) * scale),
      watermarked: !useClean,
    }
  }

  return {
    id: render.id,
    roomId: render.room_id,
    tier: render.tier,
    mode: render.mode,
    params: render.params,
    status: render.status as RenderView['status'],
    errorCode: render.error_code,
    sourceRenderId: render.source_render_id,
    isSaved: render.is_saved,
    createdAt: render.created_at,
    completedAt: render.completed_at,
    before: {
      url: await signedUrl(
        { bucket: BUCKETS.originals, path: room.original_path },
        VIEW_URL_TTL_SECONDS,
      ),
      width: room.width,
      height: room.height,
    },
    after,
  }
}
