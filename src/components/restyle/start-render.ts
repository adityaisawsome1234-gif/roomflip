import type { RestyleChoice } from '@/lib/render/request'

export type StartResult =
  | { ok: true; renderId: string }
  | { ok: false; outOfCredits: boolean; upgradeRequired: boolean; message: string }

/** POST /api/renders. One client request id per call, so a double tap is charged once. */
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
    }
  } catch {
    return {
      ok: false,
      outOfCredits: false,
      upgradeRequired: false,
      message: 'No connection. Check your internet and try again.',
    }
  }
}
