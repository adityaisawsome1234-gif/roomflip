/**
 * What to tell someone when a render did not work, by the error code stored
 * on the render. Plain words, no blame, and always what happens next.
 */
const MESSAGES: Record<string, string> = {
  timeout: 'This one took too long, so we stopped it.',
  content_policy: "The image model wouldn't work with this photo. Try a different photo or style.",
  invalid_input: "The image model couldn't use this photo. Try a different one.",
  submit_failed: "We couldn't reach the image service.",
  result_unusable: 'The image came back damaged.',
  no_image: 'The image service returned nothing.',
}

export function renderFailureMessage(code: string | null | undefined): string {
  return (code && MESSAGES[code]) || 'Something went wrong while making this image.'
}
