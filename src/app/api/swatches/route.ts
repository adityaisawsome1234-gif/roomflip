import { apiUser, json, jsonError, readUpload } from '@/lib/api'
import { UPLOAD_LIMITS } from '@/lib/images/process'
import { uploadErrorResponse } from '@/lib/upload-errors'
import { createSwatch } from '@/lib/uploads'

export const maxDuration = 30

/** Upload a fabric, tile or flooring sample photo (multipart field `photo`). */
export async function POST(request: Request) {
  const user = await apiUser()
  if (user instanceof Response) return user

  const upload = await readUpload(request, 'photo', UPLOAD_LIMITS.maxBytes)
  if (upload instanceof Response) return upload

  try {
    const swatch = await createSwatch(user.id, upload.file)
    return json({ swatch }, 201)
  } catch (error) {
    const response = uploadErrorResponse(error)
    if (response) return response
    console.error('[swatches] upload failed:', (error as Error).message)
    return jsonError(500, 'server_error', 'Something went wrong. Try again.')
  }
}
