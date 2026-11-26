import { apiUser, json, jsonError } from '@/lib/api'
import { canUseDevTools } from '@/lib/auth/admin'
import { getProvider } from '@/lib/render/providers'

export const maxDuration = 30

/** Developer tool: the state of one compare job. ?provider=&endpoint=&requestId= */
export async function GET(request: Request) {
  const user = await apiUser()
  if (user instanceof Response) return user
  if (!canUseDevTools(user)) return jsonError(403, 'forbidden', 'Developer tools are admin-only.')

  const params = new URL(request.url).searchParams
  const provider = params.get('provider') ?? ''
  const endpoint = params.get('endpoint') ?? ''
  const requestId = params.get('requestId') ?? ''
  if (!provider || !endpoint || !requestId)
    return jsonError(400, 'bad_request', 'Missing parameters.')

  try {
    return json({ state: await getProvider(provider).check(endpoint, requestId) })
  } catch (error) {
    return jsonError(400, 'bad_request', (error as Error).message)
  }
}
