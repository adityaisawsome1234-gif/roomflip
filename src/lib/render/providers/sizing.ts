import type { ModelSizing } from '@/lib/config/models'

/**
 * Output size for a render, chosen so the result has the same shape as the
 * room photo (same framing) and lands in the model's cheaper price tier.
 * Pure, so it is unit tested directly.
 */

/** Roughly how many pixels each tier asks for. */
export const TARGET_AREA = {
  preview: 1_050_000,
  // Seedream 5.0 Pro bills twice as much above 1536x1536 (2,359,296 px).
  hd: 2_300_000,
} as const

export type SizeRequest =
  { kind: 'pixels'; width: number; height: number } | { kind: 'ratio'; ratio: string }

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** Exact pixel size with the photo's aspect ratio, inside the model's limits. */
export function pixelSize(
  sourceWidth: number,
  sourceHeight: number,
  sizing: Extract<ModelSizing, { kind: 'pixels' }>,
  targetArea: number,
): { width: number; height: number } {
  const aspect = sourceWidth / sourceHeight
  const area = Math.min(Math.max(targetArea, sizing.minArea), sizing.maxArea)
  const step = sizing.multipleOf

  let width = Math.sqrt(area * aspect)
  let height = width / aspect
  // Keep inside the longest edge allowed.
  const scale = Math.min(1, sizing.maxEdge / Math.max(width, height))
  width *= scale
  height *= scale

  let w = Math.max(step, Math.round(width / step) * step)
  let h = Math.max(step, Math.round(height / step) * step)
  // Rounding can push the area just outside the allowed range; nudge it back.
  while (w * h > sizing.maxArea) {
    if (w >= h) w -= step
    else h -= step
  }
  while (w * h < sizing.minArea) {
    if (w <= h) w += step
    else h += step
  }
  return { width: w, height: h }
}

/** "4032:3024" -> "4:3". Falls back to a 1000-based ratio when the reduced form is long. */
export function ratioString(width: number, height: number): string {
  const divisor = gcd(Math.round(width), Math.round(height))
  let w = Math.round(width) / divisor
  let h = Math.round(height) / divisor
  if (w > 99_999 || h > 99_999 || w + h > 200) {
    const scale = 1000 / Math.max(width, height)
    w = Math.max(1, Math.round(width * scale))
    h = Math.max(1, Math.round(height * scale))
  }
  return `${w}:${h}`
}

/** The listed aspect ratio closest to the photo's shape. */
export function nearestPreset(width: number, height: number, presets: readonly string[]): string {
  const target = Math.log(width / height)
  let best = presets[0]
  let bestDistance = Infinity
  for (const preset of presets) {
    const [w, h] = preset.split(':').map(Number)
    const distance = Math.abs(Math.log(w / h) - target)
    if (distance < bestDistance) {
      best = preset
      bestDistance = distance
    }
  }
  return best
}

/** What to send the provider for this model, photo and tier. */
export function sizeRequest(
  sizing: ModelSizing,
  sourceWidth: number,
  sourceHeight: number,
  tier: keyof typeof TARGET_AREA,
): SizeRequest {
  switch (sizing.kind) {
    case 'pixels':
      return { kind: 'pixels', ...pixelSize(sourceWidth, sourceHeight, sizing, TARGET_AREA[tier]) }
    case 'ratio':
      return { kind: 'ratio', ratio: ratioString(sourceWidth, sourceHeight) }
    case 'ratio_preset':
      return { kind: 'ratio', ratio: nearestPreset(sourceWidth, sourceHeight, sizing.presets) }
  }
}
