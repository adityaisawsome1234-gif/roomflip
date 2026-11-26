import { describe, expect, it } from 'vitest'
import { choiceFromParams, describeChoice } from '@/lib/render/choice'
import { renderFailureMessage } from '@/lib/render/errors'
import { restyleChoiceSchema } from '@/lib/render/request'

describe('choiceFromParams', () => {
  it('rebuilds each kind of choice, and the result passes request validation', () => {
    const cases = [
      ['style', { preset: 'japandi' }],
      ['style', { custom: 'warm oak and linen' }],
      ['paint', { paintColorId: 12, surfaces: ['walls', 'trim'], color: { name: 'White Dove' } }],
      ['material', { swatchId: '6f1c8a3e-2b7d-4c1a-9e0f-1a2b3c4d5e6f', target: 'sofa' }],
    ] as const
    for (const [mode, params] of cases) {
      const choice = choiceFromParams(mode, params)
      expect(choice).not.toBeNull()
      expect(restyleChoiceSchema.safeParse(choice).success, JSON.stringify(choice)).toBe(true)
    }
  })

  it('returns null for params it does not understand', () => {
    expect(choiceFromParams('style', { preset: 'gothic' })).toBeNull()
    expect(choiceFromParams('paint', {})).toBeNull()
    expect(choiceFromParams('other', {})).toBeNull()
  })
})

describe('describeChoice', () => {
  it('gives a short label for each mode', () => {
    expect(describeChoice('style', { preset: 'midcentury' })).toBe('Mid-century')
    expect(describeChoice('style', { custom: 'x'.repeat(60) })).toHaveLength(40)
    expect(
      describeChoice('paint', { color: { name: 'Naval' }, surfaces: ['walls', 'ceiling', 'trim'] }),
    ).toBe('Naval on all walls, ceiling and trim')
    expect(describeChoice('material', { target: 'floor' })).toBe('New floor')
  })
})

describe('renderFailureMessage', () => {
  it('has a specific message for known codes and a fallback for the rest', () => {
    expect(renderFailureMessage('timeout')).toMatch(/too long/)
    expect(renderFailureMessage('weird_code')).toMatch(/Something went wrong/)
    expect(renderFailureMessage(null)).toMatch(/Something went wrong/)
  })
})
