import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Private object storage. Every bucket is private and has no client policies:
 * only the server reads and writes, and browsers get short-lived signed URLs.
 * Object paths always start with the owner's user id.
 */

export const BUCKETS = {
  originals: 'originals',
  swatches: 'swatches',
  renders: 'renders',
  exports: 'exports',
} as const

export type Bucket = (typeof BUCKETS)[keyof typeof BUCKETS]

export interface StoredObject {
  bucket: Bucket
  path: string
}

/** `<userId>/<name>`: the owner is always the first path segment. */
export function userPath(userId: string, name: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('userPath: not a user id')
  if (name.includes('..') || name.startsWith('/')) throw new Error('userPath: unsafe name')
  return `${userId}/${name}`
}

export async function putObject(
  object: StoredObject,
  data: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await createAdminClient()
    .storage.from(object.bucket)
    .upload(object.path, data, { contentType, upsert: true, cacheControl: '31536000' })
  if (error) throw new Error(`Storage upload to ${object.bucket} failed: ${error.message}`)
}

export async function getObject(object: StoredObject): Promise<Buffer> {
  const { data, error } = await createAdminClient()
    .storage.from(object.bucket)
    .download(object.path)
  if (error || !data) throw new Error(`Storage download from ${object.bucket} failed`)
  return Buffer.from(await data.arrayBuffer())
}

/** A URL anyone holding it can read until it expires. */
export async function signedUrl(object: StoredObject, expiresInSeconds: number): Promise<string> {
  const { data, error } = await createAdminClient()
    .storage.from(object.bucket)
    .createSignedUrl(object.path, expiresInSeconds)
  if (error || !data) throw new Error(`Could not sign a URL for ${object.bucket}`)
  return data.signedUrl
}

export async function removeObjects(bucket: Bucket, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await createAdminClient().storage.from(bucket).remove(paths)
}
