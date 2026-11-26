import 'server-only'

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import sharp, { type OverlayOptions } from 'sharp'
import { SITE } from '@/lib/config/site'
import type { ReelCaption } from './caption'

/**
 * Renders the two shareable exports from a finished render:
 *   reel    9:16 MP4, about 8 seconds: before -> wipe -> after -> end card
 *   square  1:1 JPEG: before on top, after below
 *
 * Every frame is composed as a still with sharp (text drawn from the bundled
 * font), then ffmpeg joins the stills with transitions. No third-party
 * branding: the only marks are ours (the end card on every reel, and a small
 * watermark for free users).
 */

const run = promisify(execFile)

const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts')
const BOLD = { name: 'Geist Bold', file: path.join(FONT_DIR, 'Geist-Bold.ttf') }
const SEMIBOLD = { name: 'Geist SemiBold', file: path.join(FONT_DIR, 'Geist-SemiBold.ttf') }

/** Brand colours, fixed for exports (videos have no light or dark mode). */
const INK = '#1c1917'
const ACCENT = '#ff7a4d'

/** Seconds on screen for each part of the reel, and the transitions between them. */
export const REEL_TIMING = { before: 3.0, after: 4.2, end: 2.0, wipe: 0.9, fade: 0.5, fps: 30 }
export const REEL_DURATION_S =
  REEL_TIMING.before + REEL_TIMING.after + REEL_TIMING.end - REEL_TIMING.wipe - REEL_TIMING.fade

function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  try {
    const bundled = createRequire(import.meta.url)('ffmpeg-static') as string | null
    if (bundled) return bundled
  } catch {
    // Not installed: fall back to a system ffmpeg.
  }
  return 'ffmpeg'
}

function escapeMarkup(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** A block of text as a transparent PNG. `markup` is Pango markup; sizes are in pixels. */
async function textBlock(
  markup: string,
  font: { name: string; file: string },
  sizePx: number,
  maxWidth: number,
  align: 'left' | 'centre' = 'centre',
): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp({
    text: {
      text: markup,
      font: `${font.name} ${Math.round(sizePx)}`,
      fontfile: font.file,
      rgba: true,
      dpi: 72,
      width: Math.round(maxWidth),
      align,
      wrap: 'word',
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/** A rounded translucent pill with a short white label. */
async function pill(label: string, sizePx: number, opacity = 0.5) {
  const text = await textBlock(
    `<span foreground="white">${escapeMarkup(label)}</span>`,
    SEMIBOLD,
    sizePx,
    2000,
  )
  const padX = Math.round(sizePx * 0.8)
  const padY = Math.round(sizePx * 0.45)
  const width = text.width + padX * 2
  const height = text.height + padY * 2
  const data = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        `<rect width="${width}" height="${height}" rx="${height / 2}" fill="black" fill-opacity="${opacity}"/></svg>`,
    ),
  )
    .composite([{ input: text.data, left: padX, top: padY }])
    .png()
    .toBuffer()
  return { data, width, height }
}

/** The photo with rounded corners, fitted inside a box. */
async function roundedPhoto(photo: Buffer, maxWidth: number, maxHeight: number, radius: number) {
  const { data, info } = await sharp(photo)
    .resize({ width: Math.round(maxWidth), height: Math.round(maxHeight), fit: 'inside' })
    .png()
    .toBuffer({ resolveWithObject: true })
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}">` +
      `<rect width="${info.width}" height="${info.height}" rx="${radius}" fill="white"/></svg>`,
  )
  const rounded = await sharp(data)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer()
  return { data: rounded, width: info.width, height: info.height }
}

/** One full reel frame: blurred backdrop, headline, the photo card, a tag, maybe a watermark. */
async function reelFrame(
  photo: Buffer,
  tag: string,
  caption: ReelCaption,
  width: number,
  height: number,
  watermark: boolean,
): Promise<Buffer> {
  const s = width / 1080
  const backdrop = await sharp(photo)
    .resize({ width, height, fit: 'cover' })
    .blur(Math.max(0.3, 34 * s))
    .modulate({ brightness: 0.42 })
    .png()
    .toBuffer()

  const headlineMarkup =
    `<span foreground="white" size="${Math.round(78 * s) * 1024}">${escapeMarkup(caption.room)}</span>\n` +
    `<span foreground="${ACCENT}" size="${Math.round(128 * s) * 1024}">→ ${escapeMarkup(caption.look)}</span>` +
    (caption.speed
      ? `\n<span foreground="#ffffffd9" size="${Math.round(50 * s) * 1024}" font_desc="${SEMIBOLD.name}">${escapeMarkup(caption.speed)}</span>`
      : '')
  const headline = await textBlock(headlineMarkup, BOLD, 78 * s, width - 120 * s)
  // Below the top tenth, which TikTok and Reels cover with their own controls.
  const headlineTop = Math.round(210 * s)

  // The card sits centred between the headline and the bottom area that the
  // platforms cover with captions and buttons (about the lowest fifth).
  const areaTop = headlineTop + headline.height + Math.round(60 * s)
  const areaBottom = height - Math.round(400 * s)
  const card = await roundedPhoto(photo, width - 96 * s, areaBottom - areaTop, 36 * s)
  const cardTop = Math.round(areaTop + (areaBottom - areaTop - card.height) / 2)
  const cardLeft = Math.round((width - card.width) / 2)

  const tagPill = await pill(tag, 32 * s, 0.6)
  const layers: OverlayOptions[] = [
    { input: headline.data, left: Math.round((width - headline.width) / 2), top: headlineTop },
    { input: card.data, left: cardLeft, top: cardTop },
    { input: tagPill.data, left: cardLeft + Math.round(24 * s), top: cardTop + Math.round(24 * s) },
  ]
  if (watermark) {
    const mark = await pill(SITE.madeWith, 30 * s, 0.45)
    layers.push({
      input: mark.data,
      left: Math.round((width - mark.width) / 2),
      top: height - mark.height - Math.round(130 * s),
    })
  }
  return sharp(backdrop).composite(layers).png().toBuffer()
}

/** The closing card: our mark and name. Shown on every reel. */
async function endCard(width: number, height: number): Promise<Buffer> {
  const s = width / 1080
  const markSize = Math.round(168 * s)
  const mark = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${markSize}" height="${markSize}">` +
      `<rect width="32" height="32" rx="9" fill="#faf8f5"/>` +
      `<path d="M32 9a9 9 0 0 0-9-9h-3L9 32h14a9 9 0 0 0 9-9V9Z" fill="${ACCENT}"/>` +
      `<path d="M20 0 9 32" stroke="${INK}" stroke-width="2" stroke-linecap="round"/></svg>`,
  )
  const title = await textBlock(
    `<span foreground="white">${escapeMarkup(SITE.madeWith)}</span>`,
    BOLD,
    60 * s,
    width - 160 * s,
  )
  const tagline = await textBlock(
    `<span foreground="#ffffffb3">${escapeMarkup(SITE.tagline)}</span>`,
    SEMIBOLD,
    38 * s,
    width - 200 * s,
  )
  const markTop = Math.round(height * 0.38)
  return sharp({ create: { width, height, channels: 4, background: INK } })
    .composite([
      {
        input: await sharp(mark).png().toBuffer(),
        left: Math.round((width - markSize) / 2),
        top: markTop,
      },
      {
        input: title.data,
        left: Math.round((width - title.width) / 2),
        top: markTop + markSize + Math.round(56 * s),
      },
      {
        input: tagline.data,
        left: Math.round((width - tagline.width) / 2),
        top: markTop + markSize + Math.round(56 * s) + title.height + Math.round(20 * s),
      },
    ])
    .png()
    .toBuffer()
}

export interface ReelResult {
  data: Buffer
  width: number
  height: number
  durationMs: number
}

/** Render the 9:16 reel as an H.264 MP4 with a silent AAC track. */
export async function renderReel(input: {
  before: Buffer
  after: Buffer
  caption: ReelCaption
  width: number
  height: number
  watermark: boolean
}): Promise<ReelResult> {
  const { width, height } = input
  const [beforeFrame, afterFrame, end] = await Promise.all([
    reelFrame(input.before, 'Before', input.caption, width, height, input.watermark),
    reelFrame(input.after, 'After', input.caption, width, height, input.watermark),
    endCard(width, height),
  ])

  const dir = await mkdtemp(path.join(os.tmpdir(), 'reel-'))
  try {
    const files = {
      before: path.join(dir, 'before.png'),
      after: path.join(dir, 'after.png'),
      end: path.join(dir, 'end.png'),
    }
    await Promise.all([
      writeFile(files.before, beforeFrame),
      writeFile(files.after, afterFrame),
      writeFile(files.end, end),
    ])
    const out = path.join(dir, 'reel.mp4')
    const t = REEL_TIMING
    const wipeAt = t.before - t.wipe
    const fadeAt = t.before + t.after - t.wipe - t.fade
    const still = (file: string, seconds: number) => [
      '-loop',
      '1',
      '-framerate',
      String(t.fps),
      '-t',
      String(seconds),
      '-i',
      file,
    ]
    await run(
      ffmpegPath(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        ...still(files.before, t.before),
        ...still(files.after, t.after),
        ...still(files.end, t.end),
        '-f',
        'lavfi',
        '-t',
        String(REEL_DURATION_S),
        '-i',
        'anullsrc=r=44100:cl=stereo',
        '-filter_complex',
        `[0:v][1:v]xfade=transition=wipeleft:duration=${t.wipe}:offset=${wipeAt}[ab];` +
          `[ab][2:v]xfade=transition=fade:duration=${t.fade}:offset=${fadeAt},format=yuv420p[v]`,
        '-map',
        '[v]',
        '-map',
        '3:a',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-profile:v',
        'high',
        '-r',
        String(t.fps),
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-shortest',
        '-movflags',
        '+faststart',
        out,
      ],
      { timeout: 45_000, maxBuffer: 4 * 1024 * 1024 },
    )
    return {
      data: await readFile(out),
      width,
      height,
      durationMs: Math.round(REEL_DURATION_S * 1000),
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Render the square before/after image as a JPEG. */
export async function renderSquare(input: {
  before: Buffer
  after: Buffer
  size: number
  watermark: boolean
}): Promise<{ data: Buffer; width: number; height: number }> {
  const size = input.size
  const s = size / 1080
  const gap = Math.max(2, Math.round(6 * s))
  const half = Math.floor((size - gap) / 2)
  const [top, bottom] = await Promise.all(
    [input.before, input.after].map((photo) =>
      sharp(photo)
        .resize({ width: size, height: half, fit: 'cover', position: 'attention' })
        .png()
        .toBuffer(),
    ),
  )
  const beforeTag = await pill('Before', 30 * s, 0.6)
  const afterTag = await pill('After', 30 * s, 0.6)
  const margin = Math.round(24 * s)
  const layers: OverlayOptions[] = [
    { input: top, left: 0, top: 0 },
    { input: bottom, left: 0, top: half + gap },
    { input: beforeTag.data, left: margin, top: margin },
    { input: afterTag.data, left: margin, top: half + gap + margin },
  ]
  if (input.watermark) {
    const mark = await pill(SITE.madeWith, 26 * s, 0.45)
    layers.push({
      input: mark.data,
      left: size - mark.width - margin,
      top: size - mark.height - margin,
    })
  }
  const data = await sharp({
    create: { width: size, height: size, channels: 3, background: '#ffffff' },
  })
    .composite(layers)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()
  return { data, width: size, height: size }
}
