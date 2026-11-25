import type { RenderTier } from './pricing'

/**
 * Image-edit models the app can use, and which one each tier uses.
 *
 * Two tiers:
 *   preview  the cheap, fast model used for first renders and regenerations
 *   hd       the premium model used for the HD final ("Save HD / Export")
 *
 * Swapping a model is a config change: edit TIER_MODEL_DEFAULTS below, or set
 * RENDER_MODEL_PREVIEW / RENDER_MODEL_HD to a model id from MODELS.
 *
 * Prices are what the provider charges us per output image at the size we
 * request. They were read from fal.ai's own model pages on the date in
 * `priceCheckedOn`; re-check them before relying on the cost reports.
 */

export type ModelProvider = 'fal' | 'mock'

export interface ModelSpec {
  /** Stable id used in config, env overrides and the renders table. */
  id: string
  provider: ModelProvider
  /** Provider endpoint id, e.g. the path after fal.run/. */
  endpoint: string
  label: string
  /** USD per output image with one input image, at the size this app requests. */
  costUsd: number
  /**
   * USD added for each input image after the first (the swatch in material
   * mode, or the chosen preview when making an HD final).
   */
  extraInputImageUsd: number
  /** Most input images one request accepts. */
  maxInputImages: number
  /** How the provider words its pricing, and anything that changes the bill. */
  pricingNote: string
  /** True when the provider labels the price as tentative or subject to change. */
  priceIsTentative: boolean
  /** True when costUsd is our estimate from token rates rather than a published per-image price. */
  priceIsEstimate: boolean
  priceCheckedOn: string
}

const CHECKED = '2026-11-25'

export const MODELS = {
  'seedream-5-pro-edit': {
    id: 'seedream-5-pro-edit',
    provider: 'fal',
    endpoint: 'bytedance/seedream/v5/pro/edit',
    label: 'Seedream 5.0 Pro',
    costUsd: 0.0675,
    extraInputImageUsd: 0.0045,
    maxInputImages: 10,
    pricingNote:
      '$0.0675 per output up to 1536x1536 (2,359,296 px) of area; $0.135 above that, up to 2048x2048. ' +
      'The default size (auto_2K) can land in the higher tier, so always send an explicit width and height.',
    priceIsTentative: true,
    priceIsEstimate: false,
    priceCheckedOn: CHECKED,
  },
  'seedream-5-flash-edit': {
    id: 'seedream-5-flash-edit',
    provider: 'fal',
    endpoint: 'bytedance/seedream/v5/flash/edit',
    label: 'Seedream 5.0 Flash',
    costUsd: 0.027,
    extraInputImageUsd: 0,
    maxInputImages: 10,
    pricingNote: '$0.027 per output image, flat.',
    priceIsTentative: false,
    priceIsEstimate: false,
    priceCheckedOn: CHECKED,
  },
  'flux-3-klein-edit': {
    id: 'flux-3-klein-edit',
    provider: 'fal',
    endpoint: 'blackforestlabs/flux-3/klein/edit-image',
    label: 'FLUX.3 Klein',
    costUsd: 0.009,
    extraInputImageUsd: 0,
    maxInputImages: 10,
    pricingNote:
      '$0.008 at 768x768, $0.009 at 1K, $0.011 at 1.5K, $0.014 at 2K. With no size set and one input ' +
      'image it renders at the input size (up to 4 MP), so always send an explicit size.',
    priceIsTentative: false,
    priceIsEstimate: false,
    priceCheckedOn: CHECKED,
  },
  'muse-image-edit': {
    id: 'muse-image-edit',
    provider: 'fal',
    endpoint: 'meta/muse-image/edit',
    label: 'Muse Image',
    costUsd: 0.01,
    extraInputImageUsd: 0,
    maxInputImages: 10,
    pricingNote: '$0.01 per output image, flat. Renders at a fixed size of roughly 2.5 MP.',
    priceIsTentative: false,
    priceIsEstimate: false,
    priceCheckedOn: CHECKED,
  },
  'nano-banana-2-edit': {
    id: 'nano-banana-2-edit',
    provider: 'fal',
    endpoint: 'fal-ai/nano-banana-2/edit',
    label: 'Nano Banana 2',
    costUsd: 0.08,
    extraInputImageUsd: 0,
    maxInputImages: 14,
    pricingNote:
      '$0.08 per image at 1K; 2K is 1.5x and 4K is 2x. Pricing is marked subject to change.',
    priceIsTentative: true,
    priceIsEstimate: false,
    priceCheckedOn: CHECKED,
  },
  'nano-banana-lite-edit': {
    id: 'nano-banana-lite-edit',
    provider: 'fal',
    endpoint: 'google/nano-banana-lite/edit',
    label: 'Nano Banana 2 Lite',
    costUsd: 0.042,
    extraInputImageUsd: 0.0004,
    maxInputImages: 14,
    pricingNote:
      'Billed by token: $37.50 per 1M output image tokens, fixed 1K output. About 1,120 tokens per ' +
      'image gives roughly $0.042. fal publishes no per-image price for this model.',
    priceIsTentative: false,
    priceIsEstimate: true,
    priceCheckedOn: CHECKED,
  },
  /** Returns a tinted copy of the input. For tests and local work without a fal key. */
  mock: {
    id: 'mock',
    provider: 'mock',
    endpoint: 'mock',
    label: 'Mock (no provider call)',
    costUsd: 0,
    extraInputImageUsd: 0,
    maxInputImages: 10,
    pricingNote: 'Free. Does not call any provider.',
    priceIsTentative: false,
    priceIsEstimate: false,
    priceCheckedOn: CHECKED,
  },
} as const satisfies Record<string, ModelSpec>

export type ModelId = keyof typeof MODELS

/**
 * Which model each tier uses unless an env override says otherwise.
 *
 * The preview default is provisional: Seedream 5.0 Flash is the cheapest model
 * from the same family as the HD model. FLUX.3 Klein and Muse Image cost about
 * a third as much; the dev compare page (milestone 3) exists to decide whether
 * they hold room geometry well enough to take over.
 */
export const TIER_MODEL_DEFAULTS: Record<RenderTier, ModelId> = {
  preview: 'seedream-5-flash-edit',
  hd: 'seedream-5-pro-edit',
}

export function isModelId(value: string): value is ModelId {
  return Object.prototype.hasOwnProperty.call(MODELS, value)
}

export function getModel(id: ModelId): ModelSpec {
  return MODELS[id]
}

export function listModels(): ModelSpec[] {
  return Object.values(MODELS)
}

/**
 * The model for a tier. `override` is the raw value of RENDER_MODEL_PREVIEW or
 * RENDER_MODEL_HD; an unknown id is a configuration error, not a silent fallback.
 */
export function resolveTierModel(tier: RenderTier, override?: string | null): ModelSpec {
  const requested = override?.trim()
  if (requested) {
    if (!isModelId(requested)) {
      throw new Error(
        `Unknown model id "${requested}" for the ${tier} tier. Valid ids: ${Object.keys(MODELS).join(', ')}`,
      )
    }
    return MODELS[requested]
  }
  return MODELS[TIER_MODEL_DEFAULTS[tier]]
}

/** What one render costs us, given how many input images the request carries. */
export function renderCostUsd(model: ModelSpec, inputImages: number = 1): number {
  const extra = Math.max(0, inputImages - 1) * model.extraInputImageUsd
  return Math.round((model.costUsd + extra) * 10_000) / 10_000
}
