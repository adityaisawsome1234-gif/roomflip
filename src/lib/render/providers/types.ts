import type { ModelSpec } from '@/lib/config/models'
import type { SizeRequest } from './sizing'

/**
 * The one interface every image-edit backend implements. The job runner only
 * talks to this, so a model or provider is swapped in config, not in code.
 *
 * Jobs are asynchronous: submit() returns a request id at once, and the result
 * arrives later through check() (polling) or a provider webhook.
 */

export interface EditRequest {
  prompt: string
  /** Input images in the order the prompt refers to them. URLs the provider can fetch. */
  imageUrls: string[]
  size: SizeRequest
}

export interface Submitted {
  requestId: string
  /** The endpoint the job went to; status lookups must use the same one. */
  endpoint: string
}

export type JobState =
  | { state: 'pending' }
  | { state: 'succeeded'; imageUrl: string }
  | {
      state: 'failed'
      /** Short machine-readable reason, stored on the render. */
      code: string
      message: string
      /** True for infrastructure failures worth one more try; false for refusals and bad input. */
      retryable: boolean
    }

export interface ImageEditProvider {
  submit(
    model: ModelSpec,
    request: EditRequest,
    options: { webhookUrl?: string },
  ): Promise<Submitted>
  check(endpoint: string, requestId: string): Promise<JobState>
}

/** Raised when a provider cannot be reached or rejects a submission. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
