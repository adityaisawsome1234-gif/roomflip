import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { canUseDevTools } from '@/lib/auth/admin'
import { getSessionUser } from '@/lib/auth/session'
import { listModels, TIER_MODEL_DEFAULTS } from '@/lib/config/models'
import { createAdminClient } from '@/lib/supabase/admin'
import { CompareTool } from './compare-tool'

export const metadata: Metadata = { title: 'Compare models', robots: { index: false } }

/**
 * Developer tool: run one room photo through several image models side by
 * side, with each model's cost per render. Local development, or admins.
 */
export default function ComparePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-1">
        <p className="text-muted text-sm font-medium">Developer tools</p>
        <h1 className="font-display text-4xl tracking-tight">Compare models</h1>
        <p className="text-muted">
          Sends the same photo and prompt to each selected model. Real models are billed by fal at
          the price shown. No credits are used.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Tool />
      </Suspense>
    </main>
  )
}

async function Tool() {
  const user = await getSessionUser()
  if (!canUseDevTools(user)) notFound()

  const { data: colors } = await createAdminClient()
    .from('paint_colors')
    .select('id, brand, name, code, hex')
    .eq('is_active', true)
    .order('brand')
    .order('sort_order')

  const models = listModels().map((model) => ({
    id: model.id,
    label: model.label,
    provider: model.provider,
    costUsd: model.costUsd,
    extraInputImageUsd: model.extraInputImageUsd,
    priceIsEstimate: model.priceIsEstimate,
    priceIsTentative: model.priceIsTentative,
    pricingNote: model.pricingNote,
    tier:
      model.id === TIER_MODEL_DEFAULTS.preview
        ? ('preview' as const)
        : model.id === TIER_MODEL_DEFAULTS.hd
          ? ('hd' as const)
          : null,
  }))

  return <CompareTool models={models} colors={colors ?? []} />
}
