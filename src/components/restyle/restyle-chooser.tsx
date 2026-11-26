'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { CREDITS } from '@/lib/config/pricing'
import { CUSTOM_STYLE } from '@/lib/config/styles'
import type { RestyleChoice } from '@/lib/render/request'
import type { PaintColor } from '@/lib/rooms-data'
import { MaterialPicker, type MaterialSelection } from './material-picker'
import { OutOfCredits } from './out-of-credits'
import { PaintPicker, type PaintSelection } from './paint-picker'
import { startRender } from './start-render'
import { StylePicker, type StyleSelection } from './style-picker'

type Tab = 'style' | 'paint' | 'material'
const TABS: { id: Tab; label: string }[] = [
  { id: 'style', label: 'Style' },
  { id: 'paint', label: 'Paint' },
  { id: 'material', label: 'Material' },
]

/** Pick a new look for a room and start the render. */
export function RestyleChooser({
  roomId,
  colors,
  balance,
}: {
  roomId: string
  colors: PaintColor[]
  balance: number
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('style')
  const [style, setStyle] = useState<StyleSelection>({ preset: 'japandi' })
  const [paint, setPaint] = useState<PaintSelection>({ colorId: null, surfaces: ['walls'] })
  const [material, setMaterial] = useState<MaterialSelection>({
    swatchId: null,
    swatchPreview: null,
    target: null,
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outOfCredits, setOutOfCredits] = useState(balance < CREDITS.cost.preview)
  const requestId = useRef<string | null>(null)

  function currentChoice(): RestyleChoice | string {
    if (tab === 'style') {
      if ('preset' in style) return { mode: 'style', preset: style.preset }
      const text = style.custom.trim()
      if (text.length < CUSTOM_STYLE.minLength) return 'Describe the style in a few words.'
      return { mode: 'style', custom: text }
    }
    if (tab === 'paint') {
      if (!paint.colorId) return 'Pick a paint colour.'
      if (paint.surfaces.length === 0) return 'Pick where the paint goes.'
      return { mode: 'paint', paintColorId: paint.colorId, surfaces: paint.surfaces }
    }
    if (!material.swatchId) return 'Add a photo of your sample.'
    if (!material.target) return 'Pick where the material goes.'
    return { mode: 'material', swatchId: material.swatchId, target: material.target }
  }

  async function submit() {
    const choice = currentChoice()
    if (typeof choice === 'string') {
      setError(choice)
      return
    }
    setError(null)
    setSubmitting(true)
    requestId.current ??= crypto.randomUUID()
    const result = await startRender({ tier: 'preview', roomId, choice }, requestId.current)
    if (result.ok) {
      requestId.current = null
      router.push(`/app/render/${result.renderId}`)
      return
    }
    // A failed attempt may be retried with the same id; a new choice gets a new one.
    if (!result.ok && result.outOfCredits) setOutOfCredits(true)
    else setError(result.message)
    requestId.current = null
    setSubmitting(false)
  }

  return (
    <div className="flex flex-col gap-5">
      <div
        role="tablist"
        aria-label="How to restyle"
        className="bg-surface-sunken grid grid-cols-3 gap-1 rounded-full p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => {
              setTab(t.id)
              setError(null)
            }}
            className={cn(
              'min-h-10 rounded-full text-sm font-semibold transition-colors',
              tab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-muted',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'style' && <StylePicker value={style} onChange={setStyle} />}
        {tab === 'paint' && <PaintPicker colors={colors} value={paint} onChange={setPaint} />}
        {tab === 'material' && <MaterialPicker value={material} onChange={setMaterial} />}
      </div>

      <div className="bg-bg/95 sticky bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom))] -mx-5 flex flex-col gap-3 px-5 pt-3 pb-4 backdrop-blur">
        {outOfCredits ? (
          <OutOfCredits reason="credits" />
        ) : (
          <>
            {error && (
              <p
                role="alert"
                className="rounded-control bg-danger-soft text-danger px-4 py-3 text-sm"
              >
                {error}
              </p>
            )}
            <Button variant="accent" size="lg" fullWidth disabled={submitting} onClick={submit}>
              {submitting ? 'Starting…' : 'Restyle my room'}
            </Button>
            <p className="text-muted text-center text-xs">
              Uses {CREDITS.cost.preview} of your {balance} {balance === 1 ? 'render' : 'renders'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
