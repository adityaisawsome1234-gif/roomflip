import { apiUser, json, jsonError, readUpload } from '@/lib/api'
import { limitRequest } from '@/lib/rate-limit'
import { UPLOAD_LIMITS } from '@/lib/images/process'
import { uploadErrorResponse } from '@/lib/upload-errors'
import { createRoom } from '@/lib/uploads'

export const maxDuration = 30

/**
 * Upload a room photo. multipart/form-data with `photo` (the image) and an
 * optional `roomType` ("living room"). The photo is re-encoded without
 * metadata and moderated before it is stored.
 */
export async function POST(request: Request) {
  const user = await apiUser()
  if (user instanceof Response) return user
  const limited = await limitRequest('upload', request, user.id)
  if (limited) return limited

  const upload = await readUpload(request, 'photo', UPLOAD_LIMITS.maxBytes)
  if (upload instanceof Response) return upload

  const roomType = upload.form.get('roomType')
  try {
    const room = await createRoom(
      user.id,
      upload.file,
      typeof roomType === 'string' ? roomType : null,
    )
    return json({ room }, 201)
  } catch (error) {
    const response = uploadErrorResponse(error)
    if (response) return response
    console.error('[rooms] upload failed:', (error as Error).message)
    return jsonError(500, 'server_error', 'Something went wrong. Try again.')
  }
}
