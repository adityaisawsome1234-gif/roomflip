import { describe, expect, it } from 'vitest'
import { MODELS } from '@/lib/config/models'
import {
  nearestPreset,
  pixelSize,
  ratioString,
  sizeRequest,
  TARGET_AREA,
} from '@/lib/render/providers/sizing'

const SEEDREAM_PRO = MODELS['seedream-5-pro-edit'].sizing
const SEEDREAM_FLASH = MODELS['seedream-5-flash-edit'].sizing
if (SEEDREAM_PRO.kind !== 'pixels' || SEEDREAM_FLASH.kind !== 'pixels') throw new Error('fixture')

const PHOTO_SHAPES: [string, number, number][] = [
  ['landscape 4:3', 4032, 3024],
  ['portrait 3:4', 3024, 4032],
  ['landscape 16:9', 1920, 1080],
  ['portrait 9:16', 1080, 1920],
  ['square', 2048, 2048],
  ['panorama 3:1', 3000, 1000],
]

describe('pixelSize', () => {
  it.each(PHOTO_SHAPES)('%s keeps the shape and the limits', (_name, w, h) => {
    for (const [sizing, target] of [
      [SEEDREAM_FLASH, TARGET_AREA.preview],
      [SEEDREAM_PRO, TARGET_AREA.hd],
    ] as const) {
      const size = pixelSize(w, h, sizing, target)
      expect(size.width % 16).toBe(0)
      expect(size.height % 16).toBe(0)
      const area = size.width * size.height
      expect(area).toBeGreaterThanOrEqual(sizing.minArea)
      expect(area).toBeLessThanOrEqual(sizing.maxArea)
      // Within 3% of the photo's aspect ratio.
      expect(Math.abs(size.width / size.height / (w / h) - 1)).toBeLessThan(0.03)
    }
  })

  it('keeps the HD final inside Seedream Pro’s cheaper price tier', () => {
    const size = pixelSize(4032, 3024, SEEDREAM_PRO, TARGET_AREA.hd)
    expect(size.width * size.height).toBeLessThanOrEqual(1536 * 1536)
    expect(size).toEqual({ width: 1744, height: 1312 })
  })

  it('raises a small preview up to the model minimum', () => {
    const size = pixelSize(1200, 900, SEEDREAM_FLASH, 500_000)
    expect(size.width * size.height).toBeGreaterThanOrEqual(921_600)
  })
})

describe('ratios', () => {
  it('reduces simple ratios and approximates awkward ones', () => {
    expect(ratioString(4032, 3024)).toBe('4:3')
    expect(ratioString(1080, 1920)).toBe('9:16')
    expect(ratioString(1001, 777)).toBe('1000:776')
  })

  it('picks the nearest preset', () => {
    const presets = ['16:9', '4:3', '1:1', '3:4', '9:16']
    expect(nearestPreset(4032, 3024, presets)).toBe('4:3')
    expect(nearestPreset(3024, 4032, presets)).toBe('3:4')
    expect(nearestPreset(2000, 1900, presets)).toBe('1:1')
    expect(nearestPreset(3000, 1000, presets)).toBe('16:9')
  })
})

describe('sizeRequest', () => {
  it('asks each model in the form it accepts', () => {
    expect(sizeRequest(MODELS['seedream-5-flash-edit'].sizing, 4032, 3024, 'preview').kind).toBe(
      'pixels',
    )
    expect(sizeRequest(MODELS['muse-image-edit'].sizing, 4032, 3024, 'preview')).toEqual({
      kind: 'ratio',
      ratio: '4:3',
    })
    expect(sizeRequest(MODELS['nano-banana-2-edit'].sizing, 3024, 4032, 'hd')).toEqual({
      kind: 'ratio',
      ratio: '3:4',
    })
  })
})
