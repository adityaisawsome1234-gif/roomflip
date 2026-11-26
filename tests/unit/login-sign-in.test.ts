import { describe, expect, it } from 'vitest'
import {
  codeSchema,
  digitsOnly,
  emailSchema,
  sendFailureMessage,
  SIGN_IN_MESSAGES,
  urlErrorMessage,
  verifyFailureMessage,
} from '@/app/login/sign-in'

describe('emailSchema', () => {
  it('trims and lowercases a valid address', () => {
    expect(emailSchema.parse('  Ada.Lovelace@Example.COM \n')).toBe('ada.lovelace@example.com')
    expect(emailSchema.parse('user+tag@example.test')).toBe('user+tag@example.test')
  })

  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['no at sign', 'not-an-email'],
    ['no domain dot', 'a@b'],
    ['space inside', 'a b@example.com'],
    ['two addresses', 'a@example.com,b@example.com'],
    ['not a string', 42],
    ['missing field', null],
    ['a file upload', new Blob(['x'])],
  ])('rejects %s', (_label, input) => {
    expect(emailSchema.safeParse(input).success).toBe(false)
  })

  it('rejects addresses longer than 254 characters', () => {
    const domain = '@example.com'
    expect(emailSchema.safeParse(`${'a'.repeat(254 - domain.length)}${domain}`).success).toBe(true)
    expect(emailSchema.safeParse(`${'a'.repeat(255 - domain.length)}${domain}`).success).toBe(false)
  })
})

describe('codeSchema', () => {
  it('accepts exactly six digits, keeping leading zeros', () => {
    expect(codeSchema.parse('012345')).toBe('012345')
    expect(codeSchema.parse(' 123456 ')).toBe('123456')
  })

  it.each([
    ['five digits', '12345'],
    ['seven digits', '1234567'],
    ['a letter', '12a456'],
    ['a space in the middle', '123 456'],
    ['full-width digits', '１２３４５６'],
    ['a sign', '-12345'],
    ['empty', ''],
    ['missing field', null],
    ['a number', 123456],
  ])('rejects %s', (_label, input) => {
    expect(codeSchema.safeParse(input).success).toBe(false)
  })
})

describe('digitsOnly', () => {
  it('keeps the digits from typed or pasted text', () => {
    expect(digitsOnly('123456')).toBe('123456')
    expect(digitsOnly('123 456')).toBe('123456')
    expect(digitsOnly('123-456\n')).toBe('123456')
    expect(digitsOnly('Your code is 048213.')).toBe('048213')
    expect(digitsOnly('abc')).toBe('')
  })

  it('never returns more than six digits', () => {
    expect(digitsOnly('1234567890')).toBe('123456')
  })
})

describe('urlErrorMessage', () => {
  it('has a specific message for each error the auth routes send', () => {
    expect(urlErrorMessage('link_expired')).toBe(
      'That sign-in link has expired or was already used. Enter your email to get a new one.',
    )
    expect(urlErrorMessage('link_invalid')).toMatch(/didn't work/)
    expect(urlErrorMessage('oauth_failed')).toMatch(/Google/)
    const messages = ['link_expired', 'link_invalid', 'oauth_failed'].map(urlErrorMessage)
    expect(new Set(messages).size).toBe(3)
  })

  it.each([
    ['unknown code', 'nope'],
    ['empty', ''],
    ['different case', 'LINK_EXPIRED'],
    ['object prototype key', 'constructor'],
    ['another prototype key', 'toString'],
    ['__proto__', '__proto__'],
    ['repeated parameter', ['link_expired', 'link_invalid']],
    ['absent', undefined],
    ['markup', '<script>alert(1)</script>'],
  ])('shows nothing for %s', (_label, value) => {
    expect(urlErrorMessage(value)).toBeNull()
  })
})

describe('sendFailureMessage', () => {
  it.each([
    [{ code: 'over_email_send_rate_limit', status: 429 }],
    [{ code: 'over_request_rate_limit', status: 429 }],
    [{ code: undefined, status: 429 }],
  ])('asks the person to wait when rate limited: %o', (failure) => {
    expect(sendFailureMessage(failure)).toBe('Too many tries. Wait a minute and try again.')
  })

  it.each([
    [{ code: 'validation_failed', status: 400 }],
    [{ code: 'email_address_invalid', status: 400 }],
  ])('points at the address when Supabase rejects it: %o', (failure) => {
    expect(sendFailureMessage(failure)).toBe(SIGN_IN_MESSAGES.invalidEmail)
  })

  it.each([
    [{ code: 'unexpected_failure', status: 500 }],
    [{ code: 'email_address_not_authorized', status: 400 }],
    [{ code: 'signup_disabled', status: 422 }],
    [{ code: 'otp_disabled', status: 422 }],
    [{ code: null, status: null }],
    [{}],
  ])('falls back to a generic message: %o', (failure) => {
    expect(sendFailureMessage(failure)).toBe("We couldn't send the email. Try again.")
  })
})

describe('verifyFailureMessage', () => {
  it('uses one message for a wrong, expired or already used code', () => {
    const expected = "That code didn't work. Check it and try again, or send a new one."
    expect(verifyFailureMessage({ code: 'otp_expired', status: 403 })).toBe(expected)
    expect(verifyFailureMessage({ code: 'validation_failed', status: 400 })).toBe(expected)
    expect(verifyFailureMessage({ code: 'unexpected_failure', status: 500 })).toBe(expected)
    expect(verifyFailureMessage({})).toBe(expected)
  })

  it('asks the person to wait when rate limited', () => {
    expect(verifyFailureMessage({ code: 'over_request_rate_limit', status: 429 })).toBe(
      SIGN_IN_MESSAGES.rateLimited,
    )
  })
})

describe('messages', () => {
  it('never end with an exclamation mark', () => {
    const all = [
      ...Object.values(SIGN_IN_MESSAGES),
      urlErrorMessage('link_expired'),
      urlErrorMessage('link_invalid'),
      urlErrorMessage('oauth_failed'),
    ]
    for (const message of all) expect(message).not.toMatch(/!/)
  })
})
