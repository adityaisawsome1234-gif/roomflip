'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { ChevronsLeftRight } from 'lucide-react'

interface Image {
  url: string
  width: number
  height: number
}

/**
 * Drag to compare. The "after" image fills the frame and the "before" image is
 * revealed from the left up to the handle. A real range input drives it, so
 * it works with the keyboard and screen readers as well as touch and mouse.
 */
export function BeforeAfterSlider({
  before,
  after,
  initial = 50,
  autoplay = false,
  beforeAlt = 'Before',
  afterAlt = 'After',
}: {
  before: Image
  after: Image
  initial?: number
  /** Sweep back and forth on its own until someone touches it (never with reduced motion). */
  autoplay?: boolean
  beforeAlt?: string
  afterAlt?: string
}) {
  const frame = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(initial)
  const dragging = useRef(false)
  const [playing, setPlaying] = useState(autoplay)

  useEffect(() => {
    if (!playing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frameId = 0
    const start = performance.now()
    const tick = (now: number) => {
      // A slow ease between 15% and 85%, starting from the middle.
      setPosition(50 + 35 * Math.sin(((now - start) / 4200) * 2 * Math.PI))
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [playing])

  const moveTo = useCallback((clientX: number) => {
    const box = frame.current?.getBoundingClientRect()
    if (!box || box.width === 0) return
    setPosition(Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100)))
  }, [])

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    setPlaying(false)
    dragging.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    moveTo(event.clientX)
  }

  return (
    <div
      ref={frame}
      className="rounded-card bg-surface-sunken relative w-full touch-pan-y overflow-hidden select-none"
      style={{ aspectRatio: `${after.width || 4} / ${after.height || 3}` }}
      onPointerDown={onPointerDown}
      onPointerMove={(event) => dragging.current && moveTo(event.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
      <img
        src={after.url}
        alt={afterAlt}
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
        <img
          src={before.url}
          alt={beforeAlt}
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>

      <span className="absolute top-3 left-3 rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white">
        Before
      </span>
      <span className="absolute top-3 right-3 rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white">
        After
      </span>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.15)]"
        style={{ left: `${position}%` }}
      >
        <span className="absolute top-1/2 left-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black shadow-lg">
          <ChevronsLeftRight className="size-5" />
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(position)}
        onChange={(event) => {
          setPlaying(false)
          setPosition(Number(event.target.value))
        }}
        onFocus={() => setPlaying(false)}
        aria-label="Compare before and after"
        aria-valuetext={`${Math.round(position)}% before`}
        className="peer absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />
      <div
        aria-hidden="true"
        className="rounded-card peer-focus-visible:outline-ring pointer-events-none absolute inset-0 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2"
      />
    </div>
  )
}
