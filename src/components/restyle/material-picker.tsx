'use client'

import { useRef, useState } from 'react'
import { Camera, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { MATERIAL_TARGET_IDS, MATERIAL_TARGETS, type MaterialTarget } from '@/lib/config/styles'
import { uploadPhoto } from './upload'

export interface MaterialSelection {
  swatchId: string | null
  swatchPreview: string | null
  target: MaterialTarget | null
}

/** Photograph a fabric, tile or flooring sample, then say where it goes. */
export function MaterialPicker({
  value,
  onChange,
}: {
  value: MaterialSelection
  onChange: (value: MaterialSelection) => void
}) {
  const camera = useRef<HTMLInputElement>(null)
  const library = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File | undefined) {
    if (!file) return
    setError(null)
    setUploading(true)
    const preview = URL.createObjectURL(file)
    const result = await uploadPhoto('/api/swatches', file)
    setUploading(false)
    if (result.ok) onChange({ ...value, swatchId: result.id, swatchPreview: preview })
    else setError(result.message)
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-4">
          <div className="rounded-control border-line bg-surface-sunken size-20 shrink-0 overflow-hidden border">
            {value.swatchPreview && (
              // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
              <img
                src={value.swatchPreview}
                alt="Your sample"
                className="h-full w-full object-cover"
              />
            )}
          </div>
          <p className="min-w-0 flex-1 text-sm" aria-live="polite">
            {uploading
              ? 'Uploading your sample…'
              : value.swatchId
                ? 'Sample ready. You can swap it for another.'
                : 'Take a close, flat photo of the fabric, tile or flooring sample.'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" disabled={uploading} onClick={() => camera.current?.click()}>
            <Camera aria-hidden="true" className="size-4" />
            Camera
          </Button>
          <Button variant="secondary" disabled={uploading} onClick={() => library.current?.click()}>
            <Upload aria-hidden="true" className="size-4" />
            Upload
          </Button>
        </div>
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <input
          ref={library}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-label="Upload a sample photo"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-control bg-danger-soft text-danger px-4 py-3 text-sm">
          {error}
        </p>
      )}

      <fieldset>
        <legend className="mb-3 text-sm font-semibold">Where does it go?</legend>
        <div
          role="radiogroup"
          aria-label="Where the material goes"
          className="flex flex-wrap gap-2"
        >
          {MATERIAL_TARGET_IDS.map((target) => {
            const on = value.target === target
            return (
              <button
                key={target}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange({ ...value, target })}
                className={cn(
                  'min-h-10 rounded-full border px-4 text-sm font-medium',
                  on ? 'border-ink bg-ink text-bg' : 'border-line bg-surface',
                )}
              >
                {MATERIAL_TARGETS[target].label}
              </button>
            )
          })}
        </div>
      </fieldset>
    </div>
  )
}
