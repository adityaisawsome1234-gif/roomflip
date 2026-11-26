import 'server-only'

import { createHash } from 'node:crypto'
import { after } from 'next/server'
import { optionalServerEnv } from '@/lib/env.server'

/**
 * Product analytics, sent to PostHog from the server only: no browser SDK, no
 * third-party script, and nothing personal beyond the user id. The browser
 * reports the one event only it can see (paywall_view) through /api/events.
 *
 * Without POSTHOG_API_KEY every call is a no-op.
 */
export type AnalyticsEvent =
  'signup' | 'render_started' | 'render_completed' | 'export_reel' | 'paywall_view' | 'purchase'

type Properties = Record<string, string | number | boolean | null | undefined>

/** A stable UUID for a dedupe key, so PostHog keeps one copy of an event sent twice. */
export function stableEventId(key: string): string {
  const hex = createHash('sha256').update(key).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export interface CaptureRequest {
  url: string
  body: {
    api_key: string
    event: string
    distinct_id: string
    properties: Properties
    timestamp: string
    uuid?: string
  }
}

/** The request PostHog's capture endpoint expects, or null when analytics is off. */
export function captureRequest(
  event: AnalyticsEvent,
  distinctId: string,
  properties: Properties = {},
  dedupeKey?: string,
): CaptureRequest | null {
  const apiKey = optionalServerEnv('POSTHOG_API_KEY')
  if (!apiKey) return null
  const host = (optionalServerEnv('POSTHOG_HOST') ?? 'https://us.i.posthog.com').replace(/\/+$/, '')
  return {
    url: `${host}/capture/`,
    body: {
      api_key: apiKey,
      event,
      distinct_id: distinctId,
      properties: { ...properties, $lib: 'roomflip-server' },
      timestamp: new Date().toISOString(),
      ...(dedupeKey ? { uuid: stableEventId(dedupeKey) } : {}),
    },
  }
}

/** Send one event. Never throws: analytics must not break the app. */
export async function track(
  event: AnalyticsEvent,
  distinctId: string,
  properties: Properties = {},
  dedupeKey?: string,
): Promise<void> {
  const request = captureRequest(event, distinctId, properties, dedupeKey)
  if (!request) return
  try {
    await fetch(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(3_000),
    })
  } catch {
    // Dropped: an analytics outage is not worth a failed request.
  }
}

/** Send after the response has gone out, when called during a request; right away otherwise. */
export function trackLater(
  event: AnalyticsEvent,
  distinctId: string,
  properties: Properties = {},
  dedupeKey?: string,
): void {
  try {
    after(() => track(event, distinctId, properties, dedupeKey))
  } catch {
    void track(event, distinctId, properties, dedupeKey)
  }
}
