import type { RestyleChoice } from '@/lib/render/request'

export type StartResult =
  | { ok: true; renderId: string }
  | {
      ok: false
      outOfCredits: boolean
      upgradeRequired: boolean
      message: string
      /**
       * False when we cannot know whether the server started the render (no
       * connection, timeout, server error). Retry with the SAME request id then,
       * so a render that did start is returned instead of charged again.
       */
      definite: boolean
    }

/**
 * POST /api/renders. The caller supplies one request id per intended render and
 * reuses it for retries of that same render, so neither a double tap nor a
 * retry after a lost response is charged twice.
 */
export async function startRender(
  body:
    | { tier: 'preview'; roomId: string; choice: RestyleChoice }
    | { tier: 'hd'; sourceRenderId: string },
  clientRequestId: string,
): Promise<StartResult> {
  try {
    const response = await fetch('/api/renders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, clientRequestId }),
    })
    const json = await response.json().catch(() => null)
    if (response.ok && json?.renderId) return { ok: true, renderId: json.renderId }
    return {
      ok: false,
      outOfCredits: response.status === 402,
      upgradeRequired: json?.error?.code === 'upgrade_required',
      message: json?.error?.message ?? 'Something went wrong. Try again.',
      definite: response.status < 500,
    }
  } catch {
    return {
      ok: false,
      outOfCredits: false,
      upgradeRequired: false,
      message: 'No connection. Check your internet and try again.',
      definite: false,
    }
  }
}
