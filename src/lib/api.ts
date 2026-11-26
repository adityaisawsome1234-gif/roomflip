import 'server-only'

import { getSessionUser, type SessionUser } from '@/lib/auth/session'

/**
 * Small helpers shared by the JSON API routes. Every response is marked
 * no-store: API answers are per user and must never be cached by a CDN.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store' }

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

/** `{ error: { code, message } }`. `message` is safe to show to the user. */
export function jsonError(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status)
}

/** The signed-in user, or a 401 response to return as-is. */
export async function apiUser(): Promise<SessionUser | Response> {
  const user = await getSessionUser()
  return user ?? jsonError(401, 'unauthorized', 'Sign in to continue.')
}

/** Read a multipart upload, refusing oversized bodies before buffering them. */
export async function readUpload(
  request: Request,
  field: string,
  maxBytes: number,
): Promise<{ file: Buffer; form: FormData } | Response> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > maxBytes + 64 * 1024) {
    return jsonError(413, 'too_large', 'That photo is too large. Try a smaller one.')
  }
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return jsonError(400, 'bad_request', 'Send the photo as a file upload.')
  }
  const entry = form.get(field)
  if (!(entry instanceof Blob) || entry.size === 0) {
    return jsonError(400, 'missing_file', 'Choose a photo first.')
  }
  if (entry.size > maxBytes) {
    return jsonError(413, 'too_large', 'That photo is too large. Try a smaller one.')
  }
  return { file: Buffer.from(await entry.arrayBuffer()), form }
}
