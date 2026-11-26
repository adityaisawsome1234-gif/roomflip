import 'server-only'

import sharp from 'sharp'

/**
 * Upload handling. Every image a user sends is decoded and re-encoded here
 * before it is stored or sent anywhere, which:
 *   - applies the EXIF orientation to the pixels, then drops ALL metadata
 *     (EXIF, GPS location, camera serials, XMP, ICC beyond sRGB);
 *   - caps the size, so models and storage never see a 50-megapixel photo;
 *   - rejects anything that is not really an image, whatever its name says.
 */

export const UPLOAD_LIMITS = {
  /**
   * Largest request body accepted. Vercel functions reject bodies over 4.5 MB,
   * so the app shrinks photos in the browser before uploading.
   */
  maxBytes: 4_400_000,
  /** Longest edge kept after processing. */
  maxEdgePx: 2048,
  /** Shortest edge accepted: smaller photos give the model too little to work with. */
  minEdgePx: 384,
  /** Decoder safety cap against decompression bombs. */
  maxInputPixels: 40_000_000,
} as const

const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp'])

export class ImageRejectedError extends Error {
  constructor(
    readonly reason: 'too_large' | 'unsupported' | 'too_small' | 'unreadable',
    message: string,
  ) {
    super(message)
    this.name = 'ImageRejectedError'
  }
}

export interface ProcessedImage {
  data: Buffer
  width: number
  height: number
  mimeType: 'image/jpeg'
}

/** Decode, orient, shrink and re-encode an uploaded photo as a metadata-free JPEG. */
export async function processUpload(input: Buffer): Promise<ProcessedImage> {
  if (input.byteLength > UPLOAD_LIMITS.maxBytes) {
    throw new ImageRejectedError('too_large', 'The photo is too large.')
  }

  let format: string | undefined
  try {
    format = (await sharp(input, { limitInputPixels: UPLOAD_LIMITS.maxInputPixels }).metadata())
      .format
  } catch {
    throw new ImageRejectedError('unreadable', 'The file is not an image we can read.')
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) {
    throw new ImageRejectedError('unsupported', 'Use a JPEG, PNG or WebP photo.')
  }

  const { data, info } = await sharp(input, { limitInputPixels: UPLOAD_LIMITS.maxInputPixels })
    // Bake the EXIF orientation into the pixels; metadata is then dropped by default.
    .rotate()
    .resize({
      width: UPLOAD_LIMITS.maxEdgePx,
      height: UPLOAD_LIMITS.maxEdgePx,
      fit: 'inside',
      withoutEnlargement: true,
    })
    // Flatten transparency (a PNG swatch) onto white so the JPEG has no black background.
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })

  if (Math.min(info.width, info.height) < UPLOAD_LIMITS.minEdgePx) {
    throw new ImageRejectedError(
      'too_small',
      'The photo is too small. Use one at least 384px wide.',
    )
  }

  return { data, width: info.width, height: info.height, mimeType: 'image/jpeg' }
}

/** Shrink a stored image for display, keeping its aspect ratio. */
export async function resizeForDisplay(input: Buffer, maxEdgePx: number): Promise<Buffer> {
  return sharp(input)
    .resize({ width: maxEdgePx, height: maxEdgePx, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer()
}
