import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MODELS } from '@/lib/config/models'
import { classifyFalError, falImageUrl, falInput } from '@/lib/render/providers/fal'
import { parseFalWebhook, verifyFalWebhook } from '@/lib/render/providers/fal-webhook'

const request = (
  size: { kind: 'pixels'; width: number; height: number } | { kind: 'ratio'; ratio: string },
) => ({
  prompt: 'p',
  imageUrls: ['https://a.test/room.jpg', 'https://a.test/swatch.jpg'],
  size,
})

describe('falInput', () => {
  it('sends Seedream an explicit pixel size', () => {
    expect(
      falInput(
        MODELS['seedream-5-pro-edit'],
        request({ kind: 'pixels', width: 1744, height: 1312 }),
      ),
    ).toEqual({
      prompt: 'p',
      image_urls: ['https://a.test/room.jpg', 'https://a.test/swatch.jpg'],
      num_images: 1,
      output_format: 'jpeg',
      image_size: { width: 1744, height: 1312 },
    })
  })

  it('turns off prompt expansion for FLUX.3 Klein', () => {
    expect(
      falInput(MODELS['flux-3-klein-edit'], request({ kind: 'pixels', width: 1184, height: 880 })),
    ).toMatchObject({
      enable_prompt_expansion: false,
      image_size: { width: 1184, height: 880 },
    })
  })

  it('sends ratio-based models an aspect ratio', () => {
    expect(
      falInput(MODELS['muse-image-edit'], request({ kind: 'ratio', ratio: '4:3' })),
    ).toMatchObject({ aspect_ratio: '4:3' })
    expect(
      falInput(MODELS['nano-banana-2-edit'], request({ kind: 'ratio', ratio: '3:4' })),
    ).toMatchObject({
      aspect_ratio: '3:4',
      resolution: '1K',
    })
  })

  it('refuses a size the model cannot take', () => {
    expect(() =>
      falInput(MODELS['seedream-5-pro-edit'], request({ kind: 'ratio', ratio: '4:3' })),
    ).toThrow()
  })

  it('has a mapping for every fal model in the catalog', () => {
    for (const model of Object.values(MODELS).filter((m) => m.provider === 'fal')) {
      const size =
        model.sizing.kind === 'pixels'
          ? ({ kind: 'pixels', width: 1024, height: 1024 } as const)
          : ({ kind: 'ratio', ratio: '1:1' } as const)
      expect(() => falInput(model, request(size)), model.id).not.toThrow()
    }
  })
})

describe('fal errors', () => {
  it('does not retry a content policy refusal', () => {
    expect(
      classifyFalError({ detail: [{ type: 'content_policy_violation', msg: 'nope' }] }, 422),
    ).toMatchObject({ code: 'content_policy', retryable: false })
  })

  it('retries infrastructure failures', () => {
    expect(classifyFalError({ error_type: 'runner_disconnected' })).toMatchObject({
      retryable: true,
    })
    expect(classifyFalError({}, 503)).toMatchObject({ retryable: true })
  })

  it('does not retry bad input', () => {
    expect(classifyFalError({ detail: [{ type: 'value_error.missing' }] }, 422)).toMatchObject({
      retryable: false,
    })
  })

  it('finds the image URL in a result', () => {
    expect(falImageUrl({ images: [{ url: 'https://fal.media/x.jpg' }] })).toBe(
      'https://fal.media/x.jpg',
    )
    expect(falImageUrl({ images: [] })).toBeNull()
    expect(falImageUrl(null)).toBeNull()
  })
})

describe('fal webhooks', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const x = publicKey.export({ format: 'jwk' }).x!
  const keys = async () => [{ kty: 'OKP', crv: 'Ed25519', x }]
  const otherKeys = async () => {
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x!
    return [{ kty: 'OKP', crv: 'Ed25519', x: other }]
  }
  const now = 1_800_000_000_000

  function signed(body: string, timestamp = String(now / 1000)) {
    const message = [
      'req-1',
      'user-1',
      timestamp,
      createHash('sha256').update(body).digest('hex'),
    ].join('\n')
    return {
      requestId: 'req-1',
      userId: 'user-1',
      timestamp,
      signature: sign(null, Buffer.from(message), privateKey).toString('hex'),
    }
  }

  it('accepts a correctly signed delivery', async () => {
    const body = '{"status":"OK"}'
    expect(await verifyFalWebhook(Buffer.from(body), signed(body), keys, () => now)).toBe(true)
  })

  it('rejects a changed body, a stale timestamp, a wrong key and missing headers', async () => {
    const body = '{"status":"OK"}'
    const headers = signed(body)
    expect(
      await verifyFalWebhook(Buffer.from('{"status":"ERROR"}'), headers, keys, () => now),
    ).toBe(false)
    expect(await verifyFalWebhook(Buffer.from(body), headers, keys, () => now + 10 * 60_000)).toBe(
      false,
    )
    expect(await verifyFalWebhook(Buffer.from(body), headers, otherKeys, () => now)).toBe(false)
    expect(
      await verifyFalWebhook(Buffer.from(body), { ...headers, signature: null }, keys, () => now),
    ).toBe(false)
    expect(
      await verifyFalWebhook(Buffer.from(body), { ...headers, signature: 'zz' }, keys, () => now),
    ).toBe(false)
  })

  it('reads success and failure bodies', () => {
    expect(
      parseFalWebhook({
        request_id: 'r',
        status: 'OK',
        payload: { images: [{ url: 'https://x/y.jpg' }] },
      }),
    ).toEqual({
      requestId: 'r',
      state: { state: 'succeeded', imageUrl: 'https://x/y.jpg' },
    })
    expect(
      parseFalWebhook({
        request_id: 'r',
        status: 'ERROR',
        payload: { detail: [{ type: 'content_policy_violation' }] },
      }),
    ).toMatchObject({ requestId: 'r', state: { state: 'failed', code: 'content_policy' } })
    expect(parseFalWebhook({ status: 'OK' })).toBeNull()
  })
})
