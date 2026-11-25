import type { Metadata } from 'next'
import { Camera, ImagePlus, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Create' }

/**
 * Create tab. The upload and restyle flow is built in milestones 3 and 4.
 * Until then this shows where it will start, with the two entry points
 * switched off. There is no file input yet on purpose.
 */
export default function CreatePage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-4xl leading-tight tracking-tight">Restyle a room</h1>
        <p className="text-muted">Add a photo of your room, then pick a new look for it.</p>
      </div>

      <section
        aria-label="Add a photo"
        className="border-line bg-surface rounded-card flex min-h-80 flex-1 flex-col items-center justify-center gap-6 border-2 border-dashed p-6 text-center"
      >
        <span className="bg-accent-soft text-accent flex size-16 items-center justify-center rounded-full">
          <ImagePlus aria-hidden="true" className="size-7" />
        </span>
        <div className="flex w-full flex-col gap-3">
          <Button variant="accent" size="lg" fullWidth disabled aria-describedby="upload-status">
            <Camera aria-hidden="true" className="size-5" />
            Take a photo
          </Button>
          <Button variant="secondary" size="lg" fullWidth disabled aria-describedby="upload-status">
            <Upload aria-hidden="true" className="size-5" />
            Upload a photo
          </Button>
        </div>
        <p id="upload-status" className="text-muted text-sm">
          Photo upload is coming in the next build.
        </p>
      </section>
    </div>
  )
}
