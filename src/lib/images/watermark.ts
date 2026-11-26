import 'server-only'

import path from 'node:path'
import sharp from 'sharp'
import { SITE } from '@/lib/config/site'

/**
 * The "Made with RoomFlip" mark on free users' images: small, bottom right, on
 * a translucent pill so it reads on light and dark rooms alike.
 *
 * Text is drawn from a bundled font file rather than system fonts, because
 * serverless hosts have none. next.config.ts includes assets/fonts in every
 * server function bundle.
 */
export const BRAND_FONT_FILE = path.join(process.cwd(), 'assets', 'fonts', 'Geist-SemiBold.ttf')
const BRAND_FONT_NAME = 'Geist SemiBold'

/** Escape text for Pango markup. */
function escapeMarkup(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Add the watermark to a JPEG and return a new JPEG of the same size. */
export async function addWatermark(input: Buffer, label: string = SITE.madeWith): Promise<Buffer> {
  const image = sharp(input)
  const { width = 1024, height = 768 } = await image.metadata()
  const shortEdge = Math.min(width, height)

  const textHeight = Math.max(12, Math.round(shortEdge * 0.028))
  const text = await sharp({
    text: {
      text: `<span foreground="white">${escapeMarkup(label)}</span>`,
      font: BRAND_FONT_NAME,
      fontfile: BRAND_FONT_FILE,
      rgba: true,
      dpi: Math.round(textHeight * 5.2),
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true })

  const padX = Math.round(textHeight * 0.8)
  const padY = Math.round(textHeight * 0.45)
  const pillWidth = text.info.width + padX * 2
  const pillHeight = text.info.height + padY * 2
  const margin = Math.round(shortEdge * 0.03)
  const radius = Math.round(pillHeight / 2)

  const pill = Buffer.from(
    `<svg width="${pillWidth}" height="${pillHeight}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${pillWidth}" height="${pillHeight}" rx="${radius}" fill="black" fill-opacity="0.42"/>` +
      `</svg>`,
  )

  return image
    .composite([
      { input: pill, left: width - pillWidth - margin, top: height - pillHeight - margin },
      {
        input: text.data,
        left: width - pillWidth - margin + padX,
        top: height - pillHeight - margin + padY,
      },
    ])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()
}
