'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, ImagePlus, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { uploadPhoto } from './upload'

const ROOM_TYPES = ['Living room', 'Bedroom', 'Kitchen', 'Bathroom', 'Dining room', 'Office']

/**
 * The start of the flow: take or choose a photo of a room. The photo is shrunk
 * in the browser (which also drops its location data), uploaded, and the user
 * moves on to choosing a new look.
 */
export function PhotoPicker() {
  const router = useRouter()
  const cameraInput = useRef<HTMLInputElement>(null)
  const libraryInput = useRef<HTMLInputElement>(null)
  const [roomType, setRoomType] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File | undefined) {
    if (!file) return
    setError(null)
    setUploading(true)
    setPreview(URL.createObjectURL(file))
    const result = await uploadPhoto('/api/rooms', file, roomType ? { roomType } : {})
    if (result.ok) {
      router.push(`/app/room/${result.id}`)
      return
    }
    setUploading(false)
    setPreview(null)
    setError(result.message)
  }

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="text-muted mb-3 text-sm font-medium">What room is it? (optional)</legend>
        <div className="flex flex-wrap gap-2">
          {ROOM_TYPES.map((type) => {
            const selected = roomType === type
            return (
              <button
                key={type}
                type="button"
                aria-pressed={selected}
                onClick={() => setRoomType(selected ? null : type)}
                className={cn(
                  'min-h-10 rounded-full border px-4 text-sm font-medium transition-colors',
                  selected
                    ? 'border-ink bg-ink text-bg'
                    : 'border-line bg-surface text-ink hover:bg-surface-sunken',
                )}
              >
                {type}
              </button>
            )
          })}
        </div>
      </fieldset>

      <section
        aria-label="Add a photo"
        aria-busy={uploading}
        className="border-muted/40 bg-surface rounded-card relative flex min-h-80 flex-col items-center justify-center gap-6 overflow-hidden border-2 border-dashed p-6 text-center"
      >
        {preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file */}
            <img
              src={preview}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-40"
            />
            <p
              role="status"
              className="bg-surface/90 text-ink relative rounded-full px-4 py-2 text-sm font-medium"
            >
              Uploading your photo…
            </p>
          </>
        ) : (
          <>
            <span className="bg-accent-soft text-accent flex size-16 items-center justify-center rounded-full">
              <ImagePlus aria-hidden="true" className="size-7" />
            </span>
            <p className="text-muted max-w-64 text-sm">
              Stand in a corner and fit as much of the room as you can. Daylight works best.
            </p>
            <div className="flex w-full flex-col gap-3">
              <Button
                variant="accent"
                size="lg"
                fullWidth
                onClick={() => cameraInput.current?.click()}
              >
                <Camera aria-hidden="true" className="size-5" />
                Take a photo
              </Button>
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                onClick={() => libraryInput.current?.click()}
              >
                <Upload aria-hidden="true" className="size-5" />
                Upload a photo
              </Button>
            </div>
          </>
        )}
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => handleFile(event.target.files?.[0])}
        />
        <input
          ref={libraryInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="sr-only"
          tabIndex={-1}
          aria-label="Upload a photo"
          onChange={(event) => handleFile(event.target.files?.[0])}
        />
      </section>

      {error && (
        <p role="alert" className="rounded-control bg-danger-soft text-danger px-4 py-3 text-sm">
          {error}
        </p>
      )}
    </div>
  )
}
