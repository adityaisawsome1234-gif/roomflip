import type { RenderTier } from './pricing'

/**
 * Timing rules for render jobs.
 *
 * A job that is still queued or processing when its deadline passes is marked
 * failed and its credits are refunded, either by the status poll or by the
 * scheduled sweeper. Pick deadlines comfortably above the provider's slowest
 * normal run: a late result after the deadline is discarded, not delivered.
 */
export const RENDER_DEADLINE_SECONDS: Record<RenderTier, number> = {
  preview: 180,
  hd: 300,
}
