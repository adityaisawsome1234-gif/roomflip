import 'server-only'

import type { ModelProvider } from '@/lib/config/models'
import { falProvider } from './fal'
import { mockProvider } from './mock'
import type { ImageEditProvider } from './types'

const PROVIDERS: Record<ModelProvider, ImageEditProvider> = {
  fal: falProvider,
  mock: mockProvider,
}

export function getProvider(provider: string): ImageEditProvider {
  if (provider === 'fal' || provider === 'mock') return PROVIDERS[provider]
  throw new Error(`Unknown image provider "${provider}"`)
}

export type { EditRequest, ImageEditProvider, JobState } from './types'
export { ProviderError } from './types'
