'use client'

import { useState } from 'react'
import { Download, Film, Share2, SquareSplitVertical } from 'lucide-react'
import { Button, buttonClasses } from '@/components/ui/button'
import { cn } from '@/lib/cn'

interface ExportView {
  kind: 'reel' | 'square'
  url: string
  downloadUrl: string
  filename: string
  mimeType: string
  width: number
  height: number
  watermarked: boolean
}

/** Share a finished look: a 9:16 reel or a square before/after image. */
export function ExportPanel({ renderId }: { renderId: string }) {
  const [busy, setBusy] = useState<ExportView['kind'] | null>(null)
  const [file, setFile] = useState<ExportView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)

  async function make(kind: ExportView['kind']) {
    setBusy(kind)
    setError(null)
    try {
      const response = await fetch(`/api/renders/${renderId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error?.message ?? "We couldn't make that file.")
      setFile(json.export)
    } catch (caught) {
      setError(
        caught instanceof TypeError ? 'No connection. Try again.' : (caught as Error).message,
      )
    } finally {
      setBusy(null)
    }
  }

  async function share(view: ExportView) {
    setSharing(true)
    try {
      const blob = await (await fetch(view.url)).blob()
      const shared = new File([blob], view.filename, { type: view.mimeType })
      if (navigator.canShare?.({ files: [shared] })) {
        await navigator.share({ files: [shared] })
      } else {
        window.location.href = view.downloadUrl
      }
    } catch {
      // The person closed the share sheet; nothing to do.
    } finally {
      setSharing(false)
    }
  }

  return (
    <section
      aria-labelledby="share-heading"
      className="rounded-card border-line bg-surface flex flex-col gap-4 border p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="share-heading" className="font-semibold">
          Share it
        </h2>
        <p className="text-muted text-sm">
          A short before-and-after video, ready for TikTok and Reels.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button
          variant={file?.kind === 'reel' ? 'primary' : 'secondary'}
          onClick={() => make('reel')}
          disabled={busy !== null}
        >
          <Film aria-hidden="true" className="size-4" />
          {busy === 'reel' ? 'Making…' : 'Video reel'}
        </Button>
        <Button
          variant={file?.kind === 'square' ? 'primary' : 'secondary'}
          onClick={() => make('square')}
          disabled={busy !== null}
        >
          <SquareSplitVertical aria-hidden="true" className="size-4" />
          {busy === 'square' ? 'Making…' : 'Square image'}
        </Button>
      </div>

      {busy === 'reel' && (
        <p role="status" className="text-muted text-sm">
          Making your video. This takes a few seconds.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-control bg-danger-soft text-danger px-4 py-3 text-sm">
          {error}
        </p>
      )}

      {file && (
        <div className="flex flex-col gap-3">
          <div
            className={cn(
              'rounded-control bg-surface-sunken mx-auto overflow-hidden',
              file.kind === 'reel' ? 'w-2/3' : 'w-full',
            )}
            style={{ aspectRatio: `${file.width} / ${file.height}` }}
          >
            {file.kind === 'reel' ? (
              <video
                key={file.url}
                src={file.url}
                aria-label="Your before-and-after video"
                className="h-full w-full object-cover"
                autoPlay
                muted
                loop
                playsInline
                controls
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              <img
                src={file.url}
                alt="Before and after, one above the other"
                className="h-full w-full object-cover"
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="accent" onClick={() => share(file)} disabled={sharing}>
              <Share2 aria-hidden="true" className="size-4" />
              Share
            </Button>
            <a
              href={file.downloadUrl}
              download={file.filename}
              className={buttonClasses({ variant: 'secondary' })}
            >
              <Download aria-hidden="true" className="size-4" />
              Download
            </a>
          </div>
          {file.watermarked && (
            <p className="text-muted text-xs">
              Free exports carry a small RoomFlip mark. Pro exports are clean and full HD.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
