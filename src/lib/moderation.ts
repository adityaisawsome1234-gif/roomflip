import 'server-only'

import sharp from 'sharp'
import { optionalServerEnv } from '@/lib/env.server'

/**
 * Image moderation with OpenAI's omni-moderation model (free to use). Every
 * room photo and swatch is checked before it is stored or sent to a model.
 *
 * Without OPENAI_API_KEY:
 *   - production refuses uploads (fails closed), so nothing unchecked is stored;
 *   - development skips the check and records that it was skipped.
 * If OpenAI cannot be reached, the upload is refused rather than let through.
 */

export type ModerationResult =
  { outcome: 'passed' } | { outcome: 'skipped' } | { outcome: 'flagged'; categories: string[] }

export class ModerationUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModerationUnavailableError'
  }
}

const ENDPOINT = 'https://api.openai.com/v1/moderations'
const MODEL = 'omni-moderation-latest'
/** The check does not need full resolution, and a smaller image is faster to send. */
const CHECK_EDGE_PX = 768

export async function moderateImage(jpeg: Buffer): Promise<ModerationResult> {
  const apiKey = optionalServerEnv('OPENAI_API_KEY')
  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new ModerationUnavailableError('OPENAI_API_KEY is not set')
    }
    return { outcome: 'skipped' }
  }

  const small = await sharp(jpeg)
    .resize({
      width: CHECK_EDGE_PX,
      height: CHECK_EDGE_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer()

  const body = JSON.stringify({
    model: MODEL,
    input: [
      {
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${small.toString('base64')}` },
      },
    ],
  })

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(15_000),
      })
      if (response.status >= 500 || response.status === 429) continue
      if (!response.ok)
        throw new ModerationUnavailableError(`OpenAI moderation HTTP ${response.status}`)

      const result = (await response.json()) as {
        results?: { flagged?: boolean; categories?: Record<string, boolean> }[]
      }
      const first = result.results?.[0]
      if (!first) throw new ModerationUnavailableError('OpenAI moderation returned no result')
      if (!first.flagged) return { outcome: 'passed' }
      const categories = Object.entries(first.categories ?? {})
        .filter(([, flagged]) => flagged)
        .map(([name]) => name)
      return { outcome: 'flagged', categories }
    } catch (error) {
      if (error instanceof ModerationUnavailableError) throw error
      // Network error or timeout: try once more, then give up.
    }
  }
  throw new ModerationUnavailableError('OpenAI moderation could not be reached')
}
