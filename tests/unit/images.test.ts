import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { ImageRejectedError, processUpload, UPLOAD_LIMITS } from '@/lib/images/process'
import { addWatermark } from '@/lib/images/watermark'

/** A photo with camera and GPS metadata and a "rotate 90°" orientation flag. */
async function phonePhoto(width = 1200, height = 900): Promise<Buffer> {
  return (
    sharp({ create: { width, height, channels: 3, background: '#8899aa' } })
      .jpeg()
      .withExif({
        IFD0: { Make: 'TestPhone', Model: 'Model X' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '51/1 30/1 0/1',
          GPSLongitudeRef: 'W',
          GPSLongitude: '0/1 7/1 0/1',
        },
      })
      // sharp ignores Orientation inside withExif; this sets the real flag.
      .withMetadata({ orientation: 6 })
      .toBuffer()
  )
}

async function rejection(input: Buffer): Promise<string> {
  try {
    await processUpload(input)
    return 'accepted'
  } catch (error) {
    if (error instanceof ImageRejectedError) return error.reason
    throw error
  }
}

describe('processUpload', () => {
  it('removes every piece of metadata, including GPS location', async () => {
    const input = await phonePhoto()
    const before = await sharp(input).metadata()
    expect(before.exif).toBeDefined()
    expect(before.orientation).toBe(6)
    expect(input.includes(Buffer.from('TestPhone'))).toBe(true)

    const { data } = await processUpload(input)
    const after = await sharp(data).metadata()
    expect(after.exif).toBeUndefined()
    expect(after.xmp).toBeUndefined()
    expect(after.iptc).toBeUndefined()
    expect(after.orientation).toBeUndefined()
    // Belt and braces: none of the metadata text survives anywhere in the file.
    expect(data.includes(Buffer.from('TestPhone'))).toBe(false)
    expect(data.includes(Buffer.from('Exif'))).toBe(false)
  })

  it('applies the orientation flag to the pixels', async () => {
    // Stored 1200x900 with "rotate 90°": the person saw a portrait photo.
    const result = await processUpload(await phonePhoto(1200, 900))
    expect([result.width, result.height]).toEqual([900, 1200])
  })

  it(`shrinks large photos to ${UPLOAD_LIMITS.maxEdgePx}px on the long edge`, async () => {
    const big = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: '#445566' },
    })
      .jpeg({ quality: 50 })
      .toBuffer()
    const result = await processUpload(big)
    expect([result.width, result.height]).toEqual([2048, 1536])
  })

  it('outputs a JPEG whatever the input format', async () => {
    const png = await sharp({
      create: { width: 800, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer()
    const result = await processUpload(png)
    expect(result.mimeType).toBe('image/jpeg')
    expect((await sharp(result.data).metadata()).format).toBe('jpeg')
    // Transparency becomes white, not black.
    const { data } = await sharp(result.data).raw().toBuffer({ resolveWithObject: true })
    expect(data[0]).toBeGreaterThan(240)
  })

  it('rejects files that are not images, unsupported formats, tiny photos and oversized uploads', async () => {
    expect(await rejection(Buffer.from('<html>not an image</html>'))).toBe('unreadable')
    const gif = await sharp({
      create: { width: 500, height: 500, channels: 3, background: '#000' },
    })
      .gif()
      .toBuffer()
    expect(await rejection(gif)).toBe('unsupported')
    const tiny = await sharp({
      create: { width: 300, height: 200, channels: 3, background: '#000' },
    })
      .jpeg()
      .toBuffer()
    expect(await rejection(tiny)).toBe('too_small')
    expect(await rejection(Buffer.alloc(UPLOAD_LIMITS.maxBytes + 1))).toBe('too_large')
  })
})

describe('addWatermark', () => {
  it('keeps the image size and changes only the bottom-right corner', async () => {
    const plain = await sharp({
      create: { width: 1024, height: 768, channels: 3, background: '#7a8b9c' },
    })
      .jpeg({ quality: 95 })
      .toBuffer()
    const marked = await addWatermark(plain)
    const meta = await sharp(marked).metadata()
    expect([meta.width, meta.height]).toEqual([1024, 768])

    const pixels = async (buffer: Buffer, left: number, top: number) =>
      sharp(buffer).extract({ left, top, width: 120, height: 40 }).raw().toBuffer()
    const diff = (a: Buffer, b: Buffer) =>
      a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length

    // Top-left untouched (allowing for JPEG noise); bottom-right visibly changed.
    expect(diff(await pixels(plain, 10, 10), await pixels(marked, 10, 10))).toBeLessThan(3)
    expect(diff(await pixels(plain, 860, 700), await pixels(marked, 860, 700))).toBeGreaterThan(10)
  })
})
