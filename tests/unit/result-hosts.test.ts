import { describe, expect, it } from 'vitest'
import { isAllowedResultUrl } from '@/lib/render/jobs'

describe('isAllowedResultUrl', () => {
  it('allows fal media hosts and image data URIs', () => {
    expect(isAllowedResultUrl('https://v3.fal.media/files/abc/out.jpg')).toBe(true)
    expect(isAllowedResultUrl('https://fal.media/x.png')).toBe(true)
    expect(isAllowedResultUrl('https://storage.googleapis.com/falserverless/x.jpg')).toBe(true)
    expect(isAllowedResultUrl('data:image/jpeg;base64,AAAA')).toBe(true)
  })

  it('refuses anything else', () => {
    for (const url of [
      'http://v3.fal.media/x.jpg',
      'https://evilfal.media/x.jpg',
      'https://fal.media.evil.test/x.jpg',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/x.jpg',
      'file:///etc/passwd',
      'data:text/html;base64,AAAA',
      'not a url',
    ]) {
      expect(isAllowedResultUrl(url), url).toBe(false)
    }
  })
})
