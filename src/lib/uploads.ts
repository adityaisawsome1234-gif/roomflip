import 'server-only'

import { randomUUID } from 'node:crypto'
import { processUpload, type ProcessedImage } from '@/lib/images/process'
import { moderateImage } from '@/lib/moderation'
import { createAdminClient } from '@/lib/supabase/admin'
import { BUCKETS, putObject, removeObjects, userPath } from '@/lib/storage'

/**
 * Turning an uploaded file into a stored room photo or swatch:
 *   1. decode, orient, shrink, strip all metadata (processUpload)
 *   2. moderate (refuse flagged images; nothing flagged is ever stored)
 *   3. store privately under the user's id, then record it
 */

export class UploadFlaggedError extends Error {
  constructor(readonly categories: string[]) {
    super('Image was flagged by moderation')
    this.name = 'UploadFlaggedError'
  }
}

async function prepare(
  file: Buffer,
): Promise<{ image: ProcessedImage; moderation: 'passed' | 'skipped' }> {
  const image = await processUpload(file)
  const result = await moderateImage(image.data)
  if (result.outcome === 'flagged') throw new UploadFlaggedError(result.categories)
  return { image, moderation: result.outcome }
}

export interface StoredUpload {
  id: string
  width: number
  height: number
}

/** Store a room photo. `roomType` is an optional label such as "living room". */
export async function createRoom(
  userId: string,
  file: Buffer,
  roomType?: string | null,
): Promise<StoredUpload> {
  const { image, moderation } = await prepare(file)
  const id = randomUUID()
  const path = userPath(userId, `${id}.jpg`)
  await putObject({ bucket: BUCKETS.originals, path }, image.data, image.mimeType)

  const cleanType = roomType?.replace(/\s+/g, ' ').trim().slice(0, 40) || null
  const { error } = await createAdminClient().from('rooms').insert({
    id,
    user_id: userId,
    room_type: cleanType,
    original_path: path,
    width: image.width,
    height: image.height,
    bytes: image.data.byteLength,
    mime_type: image.mimeType,
    moderation,
  })
  if (error) {
    await removeObjects(BUCKETS.originals, [path])
    throw new Error(`Could not save the room: ${error.message}`)
  }
  return { id, width: image.width, height: image.height }
}

/** Store a fabric, tile or flooring sample for material mode. */
export async function createSwatch(userId: string, file: Buffer): Promise<StoredUpload> {
  const { image, moderation } = await prepare(file)
  const id = randomUUID()
  const path = userPath(userId, `${id}.jpg`)
  await putObject({ bucket: BUCKETS.swatches, path }, image.data, image.mimeType)

  const { error } = await createAdminClient().from('swatches').insert({
    id,
    user_id: userId,
    path,
    width: image.width,
    height: image.height,
    bytes: image.data.byteLength,
    mime_type: image.mimeType,
    moderation,
  })
  if (error) {
    await removeObjects(BUCKETS.swatches, [path])
    throw new Error(`Could not save the swatch: ${error.message}`)
  }
  return { id, width: image.width, height: image.height }
}
