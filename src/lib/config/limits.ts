/**
 * Rate limits, per signed-in user and per client IP: [requests, window in seconds].
 * They stop abuse (scripted uploads, render floods, email bombing); a person
 * using the app normally never meets them.
 */
export type Limit = readonly [requests: number, windowSeconds: number]

export const RATE_LIMITS = {
  upload: { user: [30, 3600], ip: [60, 3600] },
  render: { user: [20, 600], ip: [60, 600] },
  export: { user: [30, 3600], ip: [60, 3600] },
  checkout: { user: [10, 600], ip: [30, 600] },
  signInEmail: { ip: [10, 600], email: [5, 600] },
  events: { user: [60, 600] },
} as const satisfies Record<string, Partial<Record<'user' | 'ip' | 'email', Limit>>>

export type RateLimitedAction = keyof typeof RATE_LIMITS
