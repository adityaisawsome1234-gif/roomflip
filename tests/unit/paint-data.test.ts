import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface PaintColor {
  brand: string
  name: string
  code: string
  hex: string
  family: string
  source: string
}

const colors: PaintColor[] = JSON.parse(readFileSync('supabase/data/paint_colors.json', 'utf8'))

describe('paint catalog data', () => {
  it('has about 200 colors split across both brands', () => {
    const byBrand = Map.groupBy(colors, (color) => color.brand)
    expect([...byBrand.keys()].sort()).toEqual(['benjamin_moore', 'sherwin_williams'])
    expect(colors.length).toBeGreaterThanOrEqual(200)
    for (const list of byBrand.values()) expect(list.length).toBeGreaterThanOrEqual(90)
  })

  it('has no duplicate codes or names within a brand', () => {
    const codes = colors.map((color) => `${color.brand}|${color.code}`)
    const names = colors.map((color) => `${color.brand}|${color.name.toLowerCase()}`)
    expect(new Set(codes).size).toBe(codes.length)
    expect(new Set(names).size).toBe(names.length)
  })

  it('uses uppercase six-digit hex and the brand code formats', () => {
    for (const color of colors) {
      expect(color.hex, `${color.code} hex`).toMatch(/^#[0-9A-F]{6}$/)
      if (color.brand === 'sherwin_williams') {
        expect(color.code).toMatch(/^SW \d{4}$/)
      } else {
        expect(color.code).toMatch(/^(?:(?:OC|HC|AF|CC|CSP|PM)-\d{1,4}|\d{3,4}(?:-\d{2})?)$/)
      }
    }
  })

  it("records each hex value's source on the manufacturer's own site", () => {
    for (const color of colors) {
      const host = new URL(color.source).hostname
      const expected =
        color.brand === 'sherwin_williams' ? 'sherwin-williams.com' : 'benjaminmoore.com'
      expect(host.endsWith(expected), `${color.code} source ${host}`).toBe(true)
    }
  })

  it('offers every color family in both brands', () => {
    const families = [
      'white',
      'off_white',
      'gray',
      'greige',
      'beige',
      'brown',
      'black',
      'blue',
      'green',
      'yellow',
      'orange',
      'red',
      'pink',
      'purple',
    ]
    for (const brand of ['benjamin_moore', 'sherwin_williams']) {
      const present = new Set(colors.filter((c) => c.brand === brand).map((c) => c.family))
      expect([...present].sort(), brand).toEqual([...families].sort())
    }
  })

  it('is fully represented in a migration', () => {
    const file = readdirSync('supabase/migrations').find((name) =>
      name.endsWith('_paint_colors_data.sql'),
    )
    expect(file).toBeDefined()
    const sql = readFileSync(`supabase/migrations/${file}`, 'utf8')
    for (const color of colors) {
      expect(sql.includes(`'${color.code}', '${color.hex}'`), `${color.brand} ${color.code}`).toBe(
        true,
      )
    }
  })
})
