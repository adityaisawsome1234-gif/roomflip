'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { shrinkImage } from '@/lib/client/shrink-image'
import { formatUsd } from '@/lib/config/pricing'
import {
  MATERIAL_TARGET_IDS,
  MATERIAL_TARGETS,
  PAINT_SURFACE_IDS,
  PAINT_SURFACES,
  STYLE_PRESET_IDS,
  STYLE_PRESETS,
} from '@/lib/config/styles'

interface ModelOption {
  id: string
  label: string
  provider: string
  costUsd: number
  extraInputImageUsd: number
  priceIsEstimate: boolean
  priceIsTentative: boolean
  pricingNote: string
  tier: 'preview' | 'hd' | null
}

interface Color {
  id: number
  brand: string
  name: string
  code: string
  hex: string
}

interface Job {
  modelId: string
  label?: string
  costUsd?: number
  priceIsEstimate?: boolean
  priceIsTentative?: boolean
  provider?: string
  endpoint?: string
  requestId?: string
  error?: string
  status: 'running' | 'done' | 'failed'
  imageUrl?: string
  seconds?: number
}

type Mode = 'style' | 'custom' | 'paint' | 'material'

const POLL_MS = 2_000

function price(value: number) {
  return value < 0.1
    ? `$${value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`
    : formatUsd(value)
}

export function CompareTool({ models, colors }: { models: ModelOption[]; colors: Color[] }) {
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [swatch, setSwatch] = useState<File | null>(null)
  const [mode, setMode] = useState<Mode>('style')
  const [preset, setPreset] = useState<string>('japandi')
  const [custom, setCustom] = useState('')
  const [colorId, setColorId] = useState<number>(colors[0]?.id ?? 0)
  const [surfaces, setSurfaces] = useState<string[]>(['walls'])
  const [target, setTarget] = useState<string>('sofa')
  const [selected, setSelected] = useState<string[]>(
    models.filter((m) => m.tier || m.id === 'flux-3-klein-edit').map((m) => m.id),
  )
  const [jobs, setJobs] = useState<Job[]>([])
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const startedAt = useRef(0)

  // Revoke the preview URL when it is replaced or the tool unmounts.
  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl)
    }
  }, [photoUrl])

  function choosePhoto(file: File | null) {
    setPhoto(file)
    setPhotoUrl(file ? URL.createObjectURL(file) : null)
  }

  // Poll every running job until all are finished.
  useEffect(() => {
    if (!jobs.some((job) => job.status === 'running')) return
    const timer = window.setTimeout(async () => {
      const next = await Promise.all(
        jobs.map(async (job) => {
          if (job.status !== 'running') return job
          const query = new URLSearchParams({
            provider: job.provider!,
            endpoint: job.endpoint!,
            requestId: job.requestId!,
          })
          const response = await fetch(`/api/dev/compare/status?${query}`)
          if (!response.ok) return job
          const { state } = await response.json()
          const seconds = Math.round((Date.now() - startedAt.current) / 100) / 10
          if (state.state === 'succeeded')
            return { ...job, status: 'done' as const, imageUrl: state.imageUrl, seconds }
          if (state.state === 'failed')
            return { ...job, status: 'failed' as const, error: state.code, seconds }
          return job
        }),
      )
      setJobs(next)
    }, POLL_MS)
    return () => window.clearTimeout(timer)
  }, [jobs])

  function choice() {
    if (mode === 'style') return { mode: 'style', preset }
    if (mode === 'custom') return { mode: 'style', custom }
    if (mode === 'paint') return { mode: 'paint', paintColorId: colorId, surfaces }
    return { mode: 'material', swatchId: '00000000-0000-4000-8000-000000000000', target }
  }

  async function run(event: FormEvent) {
    event.preventDefault()
    if (!photo) return setError('Add a room photo first.')
    if (mode === 'material' && !swatch) return setError('Add a swatch photo for material mode.')
    setError(null)
    setBusy(true)
    setJobs([])
    try {
      const form = new FormData()
      form.set('photo', await shrinkImage(photo), 'room.jpg')
      if (swatch && mode === 'material') form.set('swatch', await shrinkImage(swatch), 'swatch.jpg')
      form.set('choice', JSON.stringify(choice()))
      form.set('models', JSON.stringify(selected))
      startedAt.current = Date.now()
      const response = await fetch('/api/dev/compare', { method: 'POST', body: form })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message ?? 'Request failed')
      setPrompt(body.prompt)
      setJobs(body.jobs.map((job: Job) => ({ ...job, status: job.error ? 'failed' : 'running' })))
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const total = models
    .filter((m) => selected.includes(m.id))
    .reduce((sum, m) => sum + m.costUsd + (mode === 'material' ? m.extraInputImageUsd : 0), 0)

  return (
    <div className="flex flex-col gap-8">
      <form
        onSubmit={run}
        className="rounded-card border-line bg-surface grid gap-6 border p-5 lg:grid-cols-3"
      >
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-semibold">1. Photo</legend>
          <label className="text-sm font-medium" htmlFor="compare-photo">
            Room photo
          </label>
          <input
            id="compare-photo"
            type="file"
            accept="image/*"
            onChange={(e) => choosePhoto(e.target.files?.[0] ?? null)}
          />
          {mode === 'material' && (
            <>
              <label className="text-sm font-medium" htmlFor="compare-swatch">
                Swatch photo
              </label>
              <input
                id="compare-swatch"
                type="file"
                accept="image/*"
                onChange={(e) => setSwatch(e.target.files?.[0] ?? null)}
              />
            </>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-semibold">2. Restyle</legend>
          <label className="text-sm font-medium" htmlFor="compare-mode">
            Mode
          </label>
          <select
            id="compare-mode"
            className="rounded-control border-line bg-surface min-h-11 border px-3"
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
          >
            <option value="style">Style preset</option>
            <option value="custom">Free-text style</option>
            <option value="paint">Paint</option>
            <option value="material">Material</option>
          </select>
          {mode === 'style' && (
            <select
              aria-label="Style"
              className="rounded-control border-line bg-surface min-h-11 border px-3"
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
            >
              {STYLE_PRESET_IDS.map((id) => (
                <option key={id} value={id}>
                  {STYLE_PRESETS[id].label}
                </option>
              ))}
            </select>
          )}
          {mode === 'custom' && (
            <input
              aria-label="Style description"
              className="rounded-control border-line bg-surface min-h-11 border px-3"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="warm minimalist with oak and linen"
            />
          )}
          {mode === 'paint' && (
            <>
              <select
                aria-label="Paint colour"
                className="rounded-control border-line bg-surface min-h-11 border px-3"
                value={colorId}
                onChange={(e) => setColorId(Number(e.target.value))}
              >
                {colors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.brand === 'benjamin_moore' ? 'BM' : 'SW'} · {c.name} ({c.code})
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap gap-3 text-sm">
                {PAINT_SURFACE_IDS.map((id) => (
                  <label key={id} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={surfaces.includes(id)}
                      onChange={(e) =>
                        setSurfaces((s) =>
                          e.target.checked ? [...s, id] : s.filter((x) => x !== id),
                        )
                      }
                    />
                    {PAINT_SURFACES[id].label}
                  </label>
                ))}
              </div>
            </>
          )}
          {mode === 'material' && (
            <select
              aria-label="Where the material goes"
              className="rounded-control border-line bg-surface min-h-11 border px-3"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              {MATERIAL_TARGET_IDS.map((id) => (
                <option key={id} value={id}>
                  {MATERIAL_TARGETS[id].label}
                </option>
              ))}
            </select>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-semibold">3. Models</legend>
          {models.map((model) => (
            <label key={model.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.includes(model.id)}
                onChange={(e) =>
                  setSelected((s) =>
                    e.target.checked ? [...s, model.id] : s.filter((x) => x !== model.id),
                  )
                }
              />
              <span>
                <span className="font-medium">{model.label}</span>{' '}
                <span className="text-muted tabular-nums">
                  {price(model.costUsd)}/render{model.priceIsEstimate ? ' (estimate)' : ''}
                  {model.priceIsTentative ? ' (tentative)' : ''}
                </span>
                {model.tier && (
                  <span className="bg-accent-soft text-accent ml-1 rounded-full px-2 py-0.5 text-xs font-semibold">
                    {model.tier === 'preview' ? 'Preview model' : 'HD model'}
                  </span>
                )}
              </span>
            </label>
          ))}
          <p className="text-muted mt-2 text-sm tabular-nums">
            This run costs about {price(total)}.
          </p>
        </fieldset>

        <div className="flex flex-col gap-3 lg:col-span-3">
          {error && (
            <p
              role="alert"
              className="rounded-control bg-danger-soft text-danger px-4 py-3 text-sm"
            >
              {error}
            </p>
          )}
          <Button type="submit" variant="accent" size="lg" disabled={busy || selected.length === 0}>
            {busy
              ? 'Sending…'
              : `Run ${selected.length} ${selected.length === 1 ? 'model' : 'models'}`}
          </Button>
        </div>
      </form>

      {(photoUrl || jobs.length > 0) && (
        <section aria-label="Results" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {photoUrl && (
            <figure className="rounded-card border-line bg-surface flex flex-col gap-2 border p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
              <img src={photoUrl} alt="Original room" className="rounded-control w-full" />
              <figcaption className="text-sm font-medium">Original</figcaption>
            </figure>
          )}
          {jobs.map((job) => (
            <figure
              key={job.modelId}
              className="rounded-card border-line bg-surface flex flex-col gap-2 border p-3"
            >
              <div
                className={cn(
                  'rounded-control bg-surface-sunken flex aspect-[4/3] items-center justify-center overflow-hidden',
                  job.imageUrl && 'aspect-auto',
                )}
              >
                {job.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- provider URL or data URI
                  <img
                    src={job.imageUrl}
                    alt={`${job.label ?? job.modelId} result`}
                    className="w-full"
                  />
                ) : (
                  <span className="text-muted text-sm">
                    {job.status === 'running' ? 'Rendering…' : job.error}
                  </span>
                )}
              </div>
              <figcaption className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{job.label ?? job.modelId}</span>
                <span className="text-muted tabular-nums">
                  {job.costUsd !== undefined && `${price(job.costUsd)}`}
                  {job.seconds !== undefined && ` · ${job.seconds}s`}
                  {job.status === 'failed' && ' · failed'}
                </span>
              </figcaption>
            </figure>
          ))}
        </section>
      )}

      {prompt && (
        <details className="rounded-card border-line bg-surface border p-4 text-sm">
          <summary className="cursor-pointer font-medium">Prompt sent to every model</summary>
          <p className="text-muted mt-3 whitespace-pre-wrap">{prompt}</p>
        </details>
      )}
    </div>
  )
}
