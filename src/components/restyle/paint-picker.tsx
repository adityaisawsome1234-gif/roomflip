'use client'

import { useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { PAINT_SURFACE_IDS, PAINT_SURFACES, type PaintSurface } from '@/lib/config/styles'
import type { PaintColor } from '@/lib/rooms-data'

const BRANDS = [
  { id: 'benjamin_moore', label: 'Benjamin Moore' },
  { id: 'sherwin_williams', label: 'Sherwin-Williams' },
] as const

const FAMILIES: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'white', label: 'Whites' },
  { id: 'off_white', label: 'Off-whites' },
  { id: 'greige', label: 'Greige' },
  { id: 'gray', label: 'Grays' },
  { id: 'beige', label: 'Beige' },
  { id: 'blue', label: 'Blues' },
  { id: 'green', label: 'Greens' },
  { id: 'black', label: 'Darks' },
  { id: 'brown', label: 'Browns' },
  { id: 'warm', label: 'Warm accents' },
]
const WARM = new Set(['yellow', 'orange', 'red', 'pink', 'purple'])

export interface PaintSelection {
  colorId: number | null
  surfaces: PaintSurface[]
}

export function PaintPicker({
  colors,
  value,
  onChange,
}: {
  colors: PaintColor[]
  value: PaintSelection
  onChange: (value: PaintSelection) => void
}) {
  const [brand, setBrand] = useState<PaintColor['brand']>('benjamin_moore')
  const [family, setFamily] = useState('all')
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return colors.filter((color) => {
      if (q) return color.name.toLowerCase().includes(q) || color.code.toLowerCase().includes(q)
      if (color.brand !== brand) return false
      if (family === 'all') return true
      if (family === 'warm') return WARM.has(color.family)
      return color.family === family
    })
  }, [colors, brand, family, query])

  const selected = colors.find((color) => color.id === value.colorId)

  function toggleSurface(surface: PaintSurface) {
    const has = value.surfaces.includes(surface)
    let next = has ? value.surfaces.filter((s) => s !== surface) : [...value.surfaces, surface]
    // "All walls" and "Accent wall" are alternatives.
    if (!has && surface === 'walls') next = next.filter((s) => s !== 'accent_wall')
    if (!has && surface === 'accent_wall') next = next.filter((s) => s !== 'walls')
    onChange({ ...value, surfaces: next })
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className="bg-surface-sunken grid grid-cols-2 gap-1 rounded-full p-1"
        role="radiogroup"
        aria-label="Paint brand"
      >
        {BRANDS.map((b) => (
          <button
            key={b.id}
            type="button"
            role="radio"
            aria-checked={brand === b.id && !query}
            onClick={() => {
              setBrand(b.id)
              setQuery('')
            }}
            className={cn(
              'min-h-10 rounded-full text-sm font-semibold transition-colors',
              brand === b.id && !query ? 'bg-surface text-ink shadow-sm' : 'text-muted',
            )}
          >
            {b.label}
          </button>
        ))}
      </div>

      <label className="relative block">
        <span className="sr-only">Search colours by name or code</span>
        <Search
          aria-hidden="true"
          className="text-muted absolute top-1/2 left-4 size-4 -translate-y-1/2"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search, e.g. White Dove or SW 7036"
          className="rounded-control border-line bg-surface placeholder:text-muted min-h-12 w-full border pr-4 pl-10 text-base"
        />
      </label>

      {!query && (
        <div
          className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1"
          role="radiogroup"
          aria-label="Colour family"
        >
          {FAMILIES.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={family === f.id}
              onClick={() => setFamily(f.id)}
              className={cn(
                'min-h-9 shrink-0 rounded-full border px-3 text-sm font-medium',
                family === f.id ? 'border-ink bg-ink text-bg' : 'border-line bg-surface',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      <div
        role="radiogroup"
        aria-label="Paint colour"
        className="grid max-h-96 auto-rows-max grid-cols-3 gap-2 overflow-y-auto p-0.5 sm:grid-cols-4"
      >
        {shown.map((color) => {
          const isSelected = color.id === value.colorId
          return (
            <button
              key={color.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={`${color.name}, ${color.code}`}
              onClick={() => onChange({ ...value, colorId: color.id })}
              className={cn(
                'rounded-control flex flex-col overflow-hidden border text-left',
                isSelected ? 'border-ink ring-ink ring-2' : 'border-line',
              )}
            >
              <span className="relative block h-14" style={{ backgroundColor: color.hex }}>
                {isSelected && (
                  <Check
                    aria-hidden="true"
                    className="bg-ink text-bg absolute top-1.5 right-1.5 size-5 rounded-full p-0.5"
                  />
                )}
              </span>
              <span className="bg-surface flex flex-col px-2 py-1.5">
                <span className="truncate text-xs font-semibold">{color.name}</span>
                <span className="text-muted truncate text-[11px]">{color.code}</span>
              </span>
            </button>
          )
        })}
        {shown.length === 0 && (
          <p className="text-muted col-span-full py-6 text-center text-sm">No colours match.</p>
        )}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">
          {selected ? `Where should ${selected.name} go?` : 'Where should the paint go?'}
        </legend>
        <div className="flex flex-wrap gap-2">
          {PAINT_SURFACE_IDS.map((surface) => {
            const on = value.surfaces.includes(surface)
            return (
              <button
                key={surface}
                type="button"
                aria-pressed={on}
                onClick={() => toggleSurface(surface)}
                className={cn(
                  'min-h-10 rounded-full border px-4 text-sm font-medium',
                  on ? 'border-ink bg-ink text-bg' : 'border-line bg-surface',
                )}
              >
                {PAINT_SURFACES[surface].label}
              </button>
            )
          })}
        </div>
      </fieldset>

      <p className="text-muted text-xs">
        Colours are shown as closely as a screen allows and will look different in your light. Not
        affiliated with Benjamin Moore or Sherwin-Williams.
      </p>
    </div>
  )
}
