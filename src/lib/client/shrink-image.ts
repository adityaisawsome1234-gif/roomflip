/**
 * Shrink a photo in the browser before upload. Phone photos are often 3-12 MB,
 * over the 4.5 MB request limit of serverless functions. Re-encoding through
 * a canvas also drops the photo's metadata (including GPS) before it ever
 * leaves the device; the server strips it again regardless.
 *
 * createImageBitmap applies the EXIF orientation by default, so portrait
 * photos stay upright.
 */
export async function shrinkImage(
  file: Blob,
  { maxEdge = 2048, quality = 0.88 }: { maxEdge?: number; quality?: number } = {},
): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is not available')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the photo'))),
        'image/jpeg',
        quality,
      ),
    )
  } finally {
    bitmap.close()
  }
}
