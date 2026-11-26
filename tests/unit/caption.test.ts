import { describe, expect, it } from 'vitest'
import { reelCaption } from '@/lib/export/caption'

describe('reelCaption', () => {
  it('names the room, the look and the real render time', () => {
    expect(
      reelCaption({
        roomType: 'Living room',
        mode: 'style',
        params: { preset: 'japandi' },
        seconds: 13.6,
      }),
    ).toEqual({
      room: 'My living room',
      look: 'Japandi',
      speed: 'in 14 seconds',
    })
  })

  it('falls back to "My room" and leaves out slow renders', () => {
    expect(
      reelCaption({ roomType: null, mode: 'style', params: { preset: 'boho' }, seconds: 75 }),
    ).toEqual({
      room: 'My room',
      look: 'Boho',
      speed: null,
    })
    expect(
      reelCaption({ roomType: '  ', mode: 'style', params: { preset: 'boho' }, seconds: null })
        .speed,
    ).toBeNull()
  })

  it('uses the paint colour, the material target, and a shortened custom style', () => {
    expect(
      reelCaption({
        roomType: 'Bedroom',
        mode: 'paint',
        params: { color: { name: 'Hale Navy' } },
        seconds: 9,
      }).look,
    ).toBe('Hale Navy')
    expect(
      reelCaption({
        roomType: 'Kitchen',
        mode: 'material',
        params: { target: 'backsplash' },
        seconds: 9,
      }).look,
    ).toBe('A new backsplash')
    const custom = reelCaption({
      roomType: 'Office',
      mode: 'style',
      params: { custom: 'warm minimalist with oak floors and linen curtains' },
      seconds: 1,
    })
    expect(custom.look.length).toBeLessThanOrEqual(28)
    expect(custom.look.startsWith('Warm minimalist')).toBe(true)
    expect(custom.speed).toBe('in 1 second')
  })
})
