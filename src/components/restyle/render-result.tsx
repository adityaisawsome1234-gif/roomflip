'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bookmark, BookmarkCheck, Palette, RefreshCw, Sparkles } from 'lucide-react'
import { Button, buttonClasses } from '@/components/ui/button'
import { CREDITS } from '@/lib/config/pricing'
import { renderFailureMessage } from '@/lib/render/errors'
import type { RenderView } from '@/lib/render/jobs'
import type { RestyleChoice } from '@/lib/render/request'
import { Paywall } from '@/components/billing/paywall'
import { BeforeAfterSlider } from './before-after-slider'
import { ExportPanel } from './export-panel'
import { OutOfCredits } from './out-of-credits'
import { startRender } from './start-render'

const POLL_MS = 1_500
const STEPS = [
  'Looking at your room…',
  'Keeping the walls and windows where they are…',
  'Restyling…',
  'Adding light and detail…',
]

/** Finished in the last two minutes: arriving here straight from the render, not revisiting. */
function finishedRecently(render: RenderView): boolean {
  if (render.status !== 'succeeded' || !render.completedAt) return false
  return Date.now() - new Date(render.completedAt).getTime() < 120_000
}

function inFlight(status: RenderView['status']) {
  return status === 'queued' || status === 'processing'
}

/** Live view of one render: progress while it runs, then the before/after and what to do next. */
export function RenderResult({
  initial,
  label,
  choice,
  paid,
  isSaved: initialSaved,
  balance,
}: {
  initial: RenderView
  label: string
  choice: RestyleChoice | null
  paid: boolean
  isSaved: boolean
  /** Renders left after this one was paid for. */
  balance: number
}) {
  const router = useRouter()
  const [render, setRender] = useState(initial)
  const [elapsed, setElapsed] = useState(0)
  const [saved, setSaved] = useState(initialSaved)
  const [busy, setBusy] = useState<null | 'regenerate' | 'hd' | 'save'>(null)
  const [blocked, setBlocked] = useState<null | 'credits' | 'hd'>(null)
  const [error, setError] = useState<string | null>(null)
  // One request id per action, kept across retries after an uncertain failure.
  const pending = useRef<{ key: string; id: string } | null>(null)
  const startedAt = useRef(new Date(initial.createdAt).getTime())
  // The paywall opens right after a free user's last free render finishes: the
  // moment they have just seen what the app can do, with the result behind it.
  const [paywallOpen, setPaywallOpen] = useState(
    () => !paid && balance === 0 && finishedRecently(initial),
  )

  // Poll until the render finishes. Each poll also moves the job along on the server.
  useEffect(() => {
    if (!inFlight(render.status)) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/renders/${render.id}`, { cache: 'no-store' })
        if (!response.ok || cancelled) return
        const { render: next } = (await response.json()) as { render: RenderView }
        if (cancelled) return
        setRender(next)
        // The top bar's balance changes when a render is refunded.
        if (!inFlight(next.status)) router.refresh()
        if (next.status === 'succeeded' && !paid && balance === 0) setPaywallOpen(true)
      } catch {
        // Offline for a moment: the next poll tries again.
        if (!cancelled) setRender((current) => ({ ...current }))
      }
    }, POLL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [render, router, paid, balance])

  // A ticking clock while waiting, so the screen never looks frozen.
  useEffect(() => {
    if (!inFlight(render.status)) return
    const timer = window.setInterval(
      () => setElapsed(Math.max(0, Math.round((Date.now() - startedAt.current) / 1000))),
      1000,
    )
    return () => window.clearInterval(timer)
  }, [render.status])

  async function again(tier: 'preview' | 'hd') {
    setError(null)
    setBusy(tier === 'hd' ? 'hd' : 'regenerate')
    if (pending.current?.key !== tier) pending.current = { key: tier, id: crypto.randomUUID() }
    const id = pending.current.id
    const result =
      tier === 'hd'
        ? await startRender({ tier: 'hd', sourceRenderId: render.id }, id)
        : choice
          ? await startRender({ tier: 'preview', roomId: render.roomId, choice }, id)
          : null
    if (!result || result.ok || result.definite) pending.current = null
    if (result?.ok) {
      router.push(`/app/render/${result.renderId}`)
      return
    }
    setBusy(null)
    if (!result) setError('This look cannot be repeated. Pick it again from the room.')
    else if (result.outOfCredits) setBlocked('credits')
    else if (result.upgradeRequired) setBlocked('hd')
    else setError(result.message)
  }

  async function toggleSave() {
    setBusy('save')
    const next = !saved
    setSaved(next)
    const response = await fetch(`/api/renders/${render.id}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saved: next }),
    }).catch(() => null)
    if (!response?.ok) {
      setSaved(!next)
      setError("We couldn't save that. Try again.")
    }
    setBusy(null)
  }

  const isHd = render.tier === 'hd'
  const title = isHd ? `${label}, in HD` : label

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-4xl leading-tight tracking-tight">{title}</h1>
        {render.status === 'succeeded' && render.after?.watermarked && (
          <p className="text-muted text-sm">Free renders carry a small watermark.</p>
        )}
      </div>

      {inFlight(render.status) && (
        <section aria-live="polite" aria-busy="true" className="flex flex-col gap-3">
          <div
            className="rounded-card bg-surface-sunken relative w-full overflow-hidden"
            style={{ aspectRatio: `${render.before.width} / ${render.before.height}` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
            <img
              src={render.before.url}
              alt="Your room, being restyled"
              className="h-full w-full object-cover opacity-60 blur-[2px]"
            />
            <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          </div>
          <p className="font-medium">
            {STEPS[Math.min(STEPS.length - 1, Math.floor(elapsed / 5))]}
          </p>
          <p className="text-muted text-sm tabular-nums">
            {elapsed}s · usually 10 to 30 seconds. You can leave this screen; it keeps going.
          </p>
        </section>
      )}

      {render.status === 'succeeded' && render.after && (
        <BeforeAfterSlider before={render.before} after={render.after} />
      )}

      {render.status === 'failed' && (
        <section
          role="alert"
          className="rounded-card border-line bg-surface flex flex-col gap-2 border p-5"
        >
          <p className="font-semibold">{renderFailureMessage(render.errorCode)}</p>
          <p className="text-muted text-sm">
            Your render was given back, so this one didn&apos;t cost anything.
          </p>
        </section>
      )}

      {error && (
        <p role="alert" className="rounded-control bg-danger-soft text-danger px-4 py-3 text-sm">
          {error}
        </p>
      )}
      {blocked && <OutOfCredits reason={blocked} autoOpen />}

      {!inFlight(render.status) && (
        <div className="flex flex-col gap-3">
          {render.status === 'succeeded' && (
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="secondary"
                size="lg"
                onClick={toggleSave}
                disabled={busy !== null}
                aria-pressed={saved}
              >
                {saved ? (
                  <BookmarkCheck aria-hidden="true" className="size-5" />
                ) : (
                  <Bookmark aria-hidden="true" className="size-5" />
                )}
                {saved ? 'Saved' : 'Save'}
              </Button>
              {!isHd && (
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => (paid ? again('hd') : setBlocked('hd'))}
                  disabled={busy !== null}
                >
                  <Sparkles aria-hidden="true" className="size-5" />
                  {busy === 'hd' ? 'Starting…' : 'Save in HD'}
                </Button>
              )}
            </div>
          )}
          {!isHd && choice && (
            <Button
              variant="accent"
              size="lg"
              fullWidth
              onClick={() => again('preview')}
              disabled={busy !== null}
            >
              <RefreshCw aria-hidden="true" className="size-5" />
              {busy === 'regenerate'
                ? 'Starting…'
                : render.status === 'failed'
                  ? 'Try again'
                  : `Regenerate · ${CREDITS.cost.preview} render`}
            </Button>
          )}
          {render.status === 'succeeded' && <ExportPanel renderId={render.id} />}
          <Link
            href={`/app/room/${render.roomId}`}
            className={buttonClasses({ variant: 'ghost', size: 'lg', fullWidth: true })}
          >
            <Palette aria-hidden="true" className="size-5" />
            Try another look
          </Link>
          {isHd && render.sourceRenderId && (
            <Link
              href={`/app/render/${render.sourceRenderId}`}
              className={buttonClasses({ variant: 'ghost', fullWidth: true })}
            >
              Back to the preview
            </Link>
          )}
        </div>
      )}
      <Paywall
        open={paywallOpen}
        reason="after_result"
        onClose={() => setPaywallOpen(false)}
        returnPath={`/app/render/${render.id}`}
      />
    </div>
  )
}
