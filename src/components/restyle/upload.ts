import { shrinkImage } from '@/lib/client/shrink-image'

/** Shrink a photo in the browser, then upload it. Returns the new id or a message to show. */
export async function uploadPhoto(
  endpoint: '/api/rooms' | '/api/swatches',
  file: File,
  extra: Record<string, string> = {},
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  let body: Blob
  try {
    body = await shrinkImage(file)
  } catch {
    return { ok: false, message: "We couldn't open that photo. Try a JPEG or PNG." }
  }
  const form = new FormData()
  form.set('photo', body, 'photo.jpg')
  for (const [key, value] of Object.entries(extra)) form.set(key, value)

  try {
    const response = await fetch(endpoint, { method: 'POST', body: form })
    const json = await response.json().catch(() => null)
    if (!response.ok) {
      return { ok: false, message: json?.error?.message ?? 'Upload failed. Try again.' }
    }
    const id = json?.room?.id ?? json?.swatch?.id
    return id ? { ok: true, id } : { ok: false, message: 'Upload failed. Try again.' }
  } catch {
    return { ok: false, message: 'No connection. Check your internet and try again.' }
  }
}
