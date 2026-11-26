import 'server-only'

import { jsonError } from '@/lib/api'
import { ImageRejectedError } from '@/lib/images/process'
import { ModerationUnavailableError } from '@/lib/moderation'
import { UploadFlaggedError } from '@/lib/uploads'

/** The response for an upload that could not be stored, or null if the error is unexpected. */
export function uploadErrorResponse(error: unknown): Response | null {
  if (error instanceof ImageRejectedError) {
    const messages = {
      too_large: 'That photo is too large. Try a smaller one.',
      unsupported: 'Use a JPEG, PNG or WebP photo.',
      too_small: 'That photo is too small. Use one at least 384 pixels wide.',
      unreadable: "We couldn't read that file. Try another photo.",
    } as const
    return jsonError(error.reason === 'too_large' ? 413 : 400, error.reason, messages[error.reason])
  }
  if (error instanceof UploadFlaggedError) {
    return jsonError(422, 'flagged', "This photo can't be used. Try a photo of a room.")
  }
  if (error instanceof ModerationUnavailableError) {
    console.error('[upload] moderation unavailable:', error.message)
    return jsonError(503, 'unavailable', "We can't take photos right now. Try again in a minute.")
  }
  return null
}
