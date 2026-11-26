import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { RenderResult } from '@/components/restyle/render-result'
import { requireUser } from '@/lib/auth/session'
import { getEntitlement } from '@/lib/credits/entitlement'
import { choiceFromParams, describeChoice } from '@/lib/render/choice'
import { getRenderView } from '@/lib/render/jobs'

export const metadata: Metadata = { title: 'Your new look' }

/** One render: progress while it runs, then the before/after. */
export default function RenderPage({ params }: PageProps<'/app/render/[id]'>) {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<ResultPlaceholder />}>
        <Result params={params} />
      </Suspense>
    </div>
  )
}

async function Result({ params }: Pick<PageProps<'/app/render/[id]'>, 'params'>) {
  const { id } = await params
  const user = await requireUser(`/app/render/${id}`)
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()

  const [render, entitlement] = await Promise.all([
    getRenderView(user.id, id),
    getEntitlement(user.id),
  ])
  if (!render) notFound()

  const params_ = render.params as Record<string, unknown>
  return (
    <RenderResult
      // Remount when navigating from one render to another.
      key={render.id}
      initial={render}
      label={describeChoice(render.mode, params_)}
      choice={choiceFromParams(render.mode, params_)}
      paid={entitlement === 'paid'}
      isSaved={render.isSaved}
    />
  )
}

function ResultPlaceholder() {
  return (
    <div className="flex flex-col gap-5" aria-hidden="true">
      <div className="bg-surface-sunken h-10 w-1/2 rounded-full" />
      <div className="rounded-card bg-surface-sunken aspect-[4/3]" />
    </div>
  )
}
