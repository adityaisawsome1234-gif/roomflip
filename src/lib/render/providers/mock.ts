import 'server-only'

import sharp from 'sharp'
import { ProviderError, type ImageEditProvider } from './types'

/**
 * A free stand-in for a real model, for local development and tests. It
 * returns the room photo with a warm tint, after a short delay, so the whole
 * job pipeline (queue, poll, finalize, watermark, refund) runs for real.
 *
 * It keeps no state: everything it needs is packed into the request id.
 * Special phrases in the prompt (only possible through the free-text style)
 * make it misbehave on purpose, for testing failure handling:
 *   "mock:fail"  the job fails and cannot be retried (refund expected)
 *   "mock:flaky" the first attempt fails with a retryable error, the retry works
 *   "mock:hang"  the job never finishes (timeout and refund expected)
 */

const DELAY_MS = 1_500

type Behavior = 'ok' | 'fail' | 'flaky' | 'hang'

interface MockJob {
  /** Submitted at (ms). */
  t: number
  b: Behavior
  /** First input image. */
  u: string
  w: number
  h: number
}

function behaviorOf(prompt: string): Behavior {
  if (prompt.includes('mock:fail')) return 'fail'
  if (prompt.includes('mock:hang')) return 'hang'
  if (prompt.includes('mock:flaky')) return 'flaky'
  return 'ok'
}

/** Flaky jobs fail on their first attempt only. Resubmissions get a fresh id with b='ok'. */
const flakyAttempts = new Set<string>()

export const mockProvider: ImageEditProvider = {
  async submit(model, request) {
    const [first] = request.imageUrls
    if (!first) throw new ProviderError('mock: no input image', false)
    const size = request.size.kind === 'pixels' ? request.size : { width: 1024, height: 768 }
    // Signed URLs change on every attempt; the object path does not.
    const inputKey = first.split('?')[0]
    let behavior = behaviorOf(request.prompt)
    // A retry of a flaky job succeeds.
    if (behavior === 'flaky' && flakyAttempts.has(inputKey)) behavior = 'ok'
    if (behavior === 'flaky') flakyAttempts.add(inputKey)

    const job: MockJob = { t: Date.now(), b: behavior, u: first, w: size.width, h: size.height }
    const requestId = `mock_${Buffer.from(JSON.stringify(job)).toString('base64url')}`
    return { requestId, endpoint: model.endpoint }
  },

  async check(_endpoint, requestId) {
    let job: MockJob
    try {
      job = JSON.parse(Buffer.from(requestId.replace(/^mock_/, ''), 'base64url').toString())
    } catch {
      return { state: 'failed', code: 'not_found', message: 'Unknown mock job.', retryable: false }
    }
    if (job.b === 'hang' || Date.now() - job.t < DELAY_MS) return { state: 'pending' }
    if (job.b === 'fail') {
      return { state: 'failed', code: 'mock_failure', message: 'Mock failure.', retryable: false }
    }
    if (job.b === 'flaky') {
      return {
        state: 'failed',
        code: 'runner_disconnected',
        message: 'Mock flake.',
        retryable: true,
      }
    }

    const source = await fetch(job.u)
    if (!source.ok) {
      return {
        state: 'failed',
        code: 'input_unreachable',
        message: 'Mock could not read input.',
        retryable: false,
      }
    }
    const tinted = await sharp(Buffer.from(await source.arrayBuffer()))
      .resize({ width: job.w, height: job.h, fit: 'cover' })
      .modulate({ saturation: 0.7, brightness: 1.03 })
      .tint('#f3c9a8')
      .jpeg({ quality: 85 })
      .toBuffer()
    return { state: 'succeeded', imageUrl: `data:image/jpeg;base64,${tinted.toString('base64')}` }
  },
}
