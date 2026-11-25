import { describe, expect, it } from 'vitest'
import {
  MODELS,
  TIER_MODEL_DEFAULTS,
  listModels,
  renderCostUsd,
  resolveTierModel,
} from '@/lib/config/models'

describe('model catalog', () => {
  it('uses the premium Seedream model for the HD final', () => {
    expect(TIER_MODEL_DEFAULTS.hd).toBe('seedream-5-pro-edit')
    expect(MODELS['seedream-5-pro-edit'].endpoint).toBe('bytedance/seedream/v5/pro/edit')
  })

  it('uses a cheaper model for previews than for the HD final', () => {
    const preview = resolveTierModel('preview')
    const hd = resolveTierModel('hd')
    expect(preview.costUsd).toBeLessThan(hd.costUsd)
  })

  it('gives every model a consistent, complete record', () => {
    for (const [key, model] of Object.entries(MODELS)) {
      expect(model.id).toBe(key)
      expect(model.label.length).toBeGreaterThan(0)
      expect(model.costUsd).toBeGreaterThanOrEqual(0)
      expect(model.extraInputImageUsd).toBeGreaterThanOrEqual(0)
      // Material mode sends the room photo plus a swatch.
      expect(model.maxInputImages).toBeGreaterThanOrEqual(2)
      expect(model.priceCheckedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    const endpoints = listModels().map((model) => `${model.provider}:${model.endpoint}`)
    expect(new Set(endpoints).size).toBe(endpoints.length)
  })

  it('charges nothing for the mock model', () => {
    expect(MODELS.mock.provider).toBe('mock')
    expect(renderCostUsd(MODELS.mock, 3)).toBe(0)
  })
})

describe('resolveTierModel', () => {
  it('falls back to the default when there is no override', () => {
    expect(resolveTierModel('preview').id).toBe(TIER_MODEL_DEFAULTS.preview)
    expect(resolveTierModel('preview', '').id).toBe(TIER_MODEL_DEFAULTS.preview)
    expect(resolveTierModel('preview', '   ').id).toBe(TIER_MODEL_DEFAULTS.preview)
    expect(resolveTierModel('hd', null).id).toBe(TIER_MODEL_DEFAULTS.hd)
  })

  it('honours a valid override', () => {
    expect(resolveTierModel('preview', 'flux-3-klein-edit').id).toBe('flux-3-klein-edit')
    expect(resolveTierModel('hd', ' nano-banana-2-edit ').id).toBe('nano-banana-2-edit')
  })

  it('rejects an unknown override instead of silently using the default', () => {
    expect(() => resolveTierModel('preview', 'not-a-model')).toThrow(/Unknown model id/)
    expect(() => resolveTierModel('preview', 'toString')).toThrow(/Unknown model id/)
  })
})

describe('renderCostUsd', () => {
  it('is the base price for a single input image', () => {
    expect(renderCostUsd(MODELS['seedream-5-pro-edit'])).toBe(0.0675)
    expect(renderCostUsd(MODELS['seedream-5-flash-edit'], 1)).toBe(0.027)
  })

  it('adds the per-image charge for each extra input image', () => {
    // An HD final sends the room photo and the chosen preview.
    expect(renderCostUsd(MODELS['seedream-5-pro-edit'], 2)).toBe(0.072)
    expect(renderCostUsd(MODELS['seedream-5-pro-edit'], 3)).toBe(0.0765)
    // Flat-priced models do not charge for extra inputs.
    expect(renderCostUsd(MODELS['seedream-5-flash-edit'], 2)).toBe(0.027)
  })

  it('never goes below the base price', () => {
    expect(renderCostUsd(MODELS['seedream-5-pro-edit'], 0)).toBe(0.0675)
  })
})
