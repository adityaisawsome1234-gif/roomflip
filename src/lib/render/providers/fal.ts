import 'server-only'

import type { ModelSpec } from '@/lib/config/models'
import { serverEnv } from '@/lib/env.server'
import type { SizeRequest } from './sizing'
import { ProviderError, type EditRequest, type ImageEditProvider, type JobState } from './types'

/**
 * fal.ai queue API, called over plain HTTP (no SDK needed).
 *   submit  POST https://queue.fal.run/{endpoint}?fal_webhook=...
 *   status  GET  https://queue.fal.run/{owner}/{app}/requests/{id}/status
 *   result  GET  https://queue.fal.run/{owner}/{app}/requests/{id}
 * Status and result URLs use only the first two segments of the endpoint id.
 */

const QUEUE_BASE = 'https://queue.fal.run'
const TIMEOUT_MS = 20_000

/** fal error types that are infrastructure trouble, worth one retry. */
const RETRYABLE_ERROR_TYPES = new Set([
  'request_timeout',
  'startup_timeout',
  'runner_scheduling_failure',
  'runner_connection_timeout',
  'runner_disconnected',
  'runner_connection_refused',
  'runner_connection_error',
  'runner_incomplete_response',
  'runner_server_error',
  'internal_error',
])

function headers(): HeadersInit {
  return { Authorization: `Key ${serverEnv('FAL_KEY')}`, 'Content-Type': 'application/json' }
}

function requestBase(endpoint: string, requestId: string): string {
  const [owner, app] = endpoint.split('/')
  return `${QUEUE_BASE}/${owner}/${app}/requests/${encodeURIComponent(requestId)}`
}

/** The model-specific request body. Each model names its size controls differently. */
export function falInput(model: ModelSpec, request: EditRequest): Record<string, unknown> {
  const base = {
    prompt: request.prompt,
    image_urls: request.imageUrls,
    num_images: 1,
    output_format: 'jpeg',
  }
  const size: SizeRequest = request.size

  switch (model.id) {
    case 'seedream-5-pro-edit':
    case 'seedream-5-flash-edit':
      if (size.kind !== 'pixels') throw new Error(`${model.id} needs a pixel size`)
      return { ...base, image_size: { width: size.width, height: size.height } }
    case 'flux-3-klein-edit':
      if (size.kind !== 'pixels') throw new Error(`${model.id} needs a pixel size`)
      // Prompt expansion rewrites the instruction and tends to drift from the room's geometry.
      return {
        ...base,
        image_size: { width: size.width, height: size.height },
        enable_prompt_expansion: false,
      }
    case 'muse-image-edit':
      if (size.kind !== 'ratio') throw new Error(`${model.id} needs a ratio`)
      return { ...base, aspect_ratio: size.ratio }
    case 'nano-banana-2-edit':
      if (size.kind !== 'ratio') throw new Error(`${model.id} needs a ratio`)
      return { ...base, aspect_ratio: size.ratio, resolution: '1K' }
    case 'nano-banana-lite-edit':
      if (size.kind !== 'ratio') throw new Error(`${model.id} needs a ratio`)
      return { ...base, aspect_ratio: size.ratio }
    default:
      throw new Error(`No fal input mapping for model ${model.id}`)
  }
}

/** Turn a fal error body into a short code and a retry decision. */
export function classifyFalError(
  body: unknown,
  httpStatus?: number,
): JobState & { state: 'failed' } {
  const record = (body ?? {}) as Record<string, unknown>
  const errorType = typeof record.error_type === 'string' ? record.error_type : undefined
  const detail = record.detail
  const details = Array.isArray(detail) ? (detail as Record<string, unknown>[]) : []
  const detailType = details.find((d) => typeof d.type === 'string')?.type as string | undefined

  if (detailType === 'content_policy_violation') {
    return {
      state: 'failed',
      code: 'content_policy',
      message: 'The model refused this image.',
      retryable: false,
    }
  }
  if (errorType && RETRYABLE_ERROR_TYPES.has(errorType)) {
    return {
      state: 'failed',
      code: errorType,
      message: 'The model service had a problem.',
      retryable: true,
    }
  }
  if (httpStatus === 422 || detailType) {
    return {
      state: 'failed',
      code: detailType ?? 'invalid_input',
      message: 'The model could not use this input.',
      retryable: false,
    }
  }
  const retryable = !httpStatus || httpStatus >= 500
  return {
    state: 'failed',
    code: errorType ?? `http_${httpStatus ?? 'error'}`,
    message: 'The model service had a problem.',
    retryable,
  }
}

/** First image URL in a fal result payload, if any. */
export function falImageUrl(payload: unknown): string | null {
  const images = (payload as { images?: { url?: unknown }[] } | null)?.images
  const url = Array.isArray(images) ? images[0]?.url : undefined
  return typeof url === 'string' && url.length > 0 ? url : null
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export const falProvider: ImageEditProvider = {
  async submit(model, request, { webhookUrl }) {
    const url = new URL(`${QUEUE_BASE}/${model.endpoint}`)
    if (webhookUrl) url.searchParams.set('fal_webhook', webhookUrl)

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(falInput(model, request)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      throw new ProviderError(`fal submit failed: ${(error as Error).message}`, true)
    }
    const body = (await readJson(response)) as { request_id?: unknown } | null
    if (!response.ok || typeof body?.request_id !== 'string') {
      throw new ProviderError(
        `fal submit returned HTTP ${response.status}`,
        response.status === 429 || response.status >= 500,
      )
    }
    return { requestId: body.request_id, endpoint: model.endpoint }
  },

  async check(endpoint, requestId) {
    const base = requestBase(endpoint, requestId)
    let statusResponse: Response
    try {
      statusResponse = await fetch(`${base}/status`, {
        headers: headers(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      // Could not reach fal: say nothing has changed and let the next poll retry.
      return { state: 'pending' }
    }
    if (statusResponse.status === 404) {
      return {
        state: 'failed',
        code: 'not_found',
        message: 'The provider lost this job.',
        retryable: true,
      }
    }
    const status = (await readJson(statusResponse)) as Record<string, unknown> | null
    if (!statusResponse.ok || !status) return { state: 'pending' }
    if (status.status !== 'COMPLETED') return { state: 'pending' }
    if (status.error || status.error_type) return classifyFalError(status)

    let resultResponse: Response
    try {
      resultResponse = await fetch(base, {
        headers: headers(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      return { state: 'pending' }
    }
    const result = await readJson(resultResponse)
    if (!resultResponse.ok) return classifyFalError(result, resultResponse.status)

    const imageUrl = falImageUrl(result)
    return imageUrl
      ? { state: 'succeeded', imageUrl }
      : {
          state: 'failed',
          code: 'no_image',
          message: 'The model returned no image.',
          retryable: true,
        }
  },
}
