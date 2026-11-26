'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  CUSTOM_STYLE,
  STYLE_PRESET_IDS,
  STYLE_PRESETS,
  type StylePresetId,
} from '@/lib/config/styles'

/** A hint of each style's palette on its card. Display only. */
const PALETTES: Record<StylePresetId, [string, string, string]> = {
  modern: ['#E9E9E6', '#8C8C88', '#1F1F1F'],
  japandi: ['#E8DED0', '#B59A7A', '#3B3632'],
  scandinavian: ['#F4F3EF', '#D9CBB4', '#9AA89A'],
  midcentury: ['#C8A15A', '#2F6F73', '#8B4A2B'],
  coastal: ['#F6F2EA', '#A9C6D6', '#3C6E8F'],
  industrial: ['#6A6A67', '#8A5A3C', '#1E1E1E'],
  traditional: ['#EFE6D6', '#7A2E2E', '#23395D'],
  boho: ['#D7B98E', '#C0673A', '#6B7F4E'],
}

export type StyleSelection = { preset: StylePresetId } | { custom: string }

export function StylePicker({
  value,
  onChange,
}: {
  value: StyleSelection
  onChange: (value: StyleSelection) => void
}) {
  const custom = 'custom' in value
  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Style" className="grid grid-cols-2 gap-3">
        {STYLE_PRESET_IDS.map((id) => {
          const selected = !custom && value.preset === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange({ preset: id })}
              className={cn(
                'rounded-card relative flex min-h-24 flex-col gap-2 border p-3 text-left transition-colors',
                selected
                  ? 'border-ink bg-surface ring-ink ring-1'
                  : 'border-line bg-surface hover:bg-surface-sunken',
              )}
            >
              <span className="flex gap-1" aria-hidden="true">
                {PALETTES[id].map((color) => (
                  <span
                    key={color}
                    className="border-line size-4 rounded-full border"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
              <span className="font-semibold">{STYLE_PRESETS[id].label}</span>
              <span className="text-muted text-xs leading-snug">{STYLE_PRESETS[id].blurb}</span>
              {selected && (
                <Check
                  aria-hidden="true"
                  className="bg-ink text-bg absolute top-2.5 right-2.5 size-5 rounded-full p-0.5"
                />
              )}
            </button>
          )
        })}
      </div>

      <div
        className={cn(
          'rounded-card border p-3',
          custom ? 'border-ink ring-ink ring-1' : 'border-line',
        )}
      >
        <label htmlFor="custom-style" className="text-sm font-semibold">
          Or describe your own
        </label>
        <textarea
          id="custom-style"
          rows={2}
          maxLength={CUSTOM_STYLE.maxLength}
          placeholder="Warm minimalist, oak floors, linen and plants"
          value={custom ? value.custom : ''}
          onFocus={() => !custom && onChange({ custom: '' })}
          onChange={(event) => onChange({ custom: event.target.value })}
          className="bg-surface placeholder:text-muted mt-2 w-full resize-none text-base outline-none"
        />
      </div>
    </div>
  )
}
