import { describe, expect, it } from 'vitest'
import { isProtectedPath, loginPath, safeNextPath } from '@/lib/auth/redirects'

describe('safeNextPath', () => {
  it('keeps same-site paths, including query and hash', () => {
    expect(safeNextPath('/app')).toBe('/app')
    expect(safeNextPath('/app/rooms?tab=saved#top')).toBe('/app/rooms?tab=saved#top')
  })

  it.each([
    ['absolute URL', 'https://evil.example/app'],
    ['protocol-relative URL', '//evil.example/app'],
    ['backslash host trick', '/\\evil.example'],
    ['backslash after slash', '/app\\..\\evil'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['no leading slash', 'app/rooms'],
    ['control character', '/app\n/evil'],
    ['tab that browsers strip', '/\t/evil.example'],
    ['empty string', ''],
    ['non-string', 42],
    ['null', null],
    ['undefined', undefined],
    ['too long', `/${'a'.repeat(600)}`],
  ])('falls back for %s', (_label, input) => {
    expect(safeNextPath(input)).toBe('/app')
  })

  it('never returns to the auth pages themselves', () => {
    expect(safeNextPath('/login')).toBe('/app')
    expect(safeNextPath('/login?next=/app')).toBe('/app')
    expect(safeNextPath('/auth/confirm?token_hash=x')).toBe('/app')
  })

  it('normalises dot segments instead of leaving the site', () => {
    expect(safeNextPath('/app/../../etc')).toBe('/etc')
    expect(safeNextPath('/app/..//evil.example')).toBe('/app')
  })

  it('uses the caller fallback when given', () => {
    expect(safeNextPath('https://evil.example', '')).toBe('')
  })
})

describe('isProtectedPath', () => {
  it('protects the app, admin and dev areas', () => {
    for (const path of ['/app', '/app/rooms', '/admin', '/admin/users', '/dev/compare']) {
      expect(isProtectedPath(path)).toBe(true)
    }
  })

  it('leaves public pages and look-alike prefixes open', () => {
    for (const path of ['/', '/login', '/auth/confirm', '/apple', '/application', '/developers']) {
      expect(isProtectedPath(path)).toBe(false)
    }
  })
})

describe('loginPath', () => {
  it('carries a safe return path', () => {
    expect(loginPath('/app/rooms')).toBe('/login?next=%2Fapp%2Frooms')
  })

  it('drops an unsafe return path', () => {
    expect(loginPath('https://evil.example')).toBe('/login')
    expect(loginPath()).toBe('/login')
  })
})
