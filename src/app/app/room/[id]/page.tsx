import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { RestyleChooser } from '@/components/restyle/restyle-chooser'
import { requireUser } from '@/lib/auth/session'
import { getCreditBalances } from '@/lib/credits/ledger'
import { getOwnedRoom, getPaintCatalog, listRoomRenders } from '@/lib/rooms-data'

export const metadata: Metadata = { title: 'New look' }

/** Choose a new look for an uploaded room. */
export default function RoomPage({ params }: PageProps<'/app/room/[id]'>) {
  return (
    <div className="flex flex-1 flex-col gap-5">
      <Suspense fallback={<RoomPlaceholder />}>
        <Room params={params} />
      </Suspense>
    </div>
  )
}

async function Room({ params }: Pick<PageProps<'/app/room/[id]'>, 'params'>) {
  const { id } = await params
  const user = await requireUser(`/app/room/${id}`)
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()

  const [room, colors, balances, looks] = await Promise.all([
    getOwnedRoom(user.id, id),
    getPaintCatalog(),
    getCreditBalances(user.id),
    listRoomRenders(user.id, id),
  ])
  if (!room) notFound()

  return (
    <>
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-4xl leading-tight tracking-tight">Pick a new look</h1>
        <div
          className="rounded-card bg-surface-sunken w-full overflow-hidden"
          style={{ aspectRatio: `${room.width} / ${room.height}` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
          <img src={room.photoUrl} alt="Your room" className="h-full w-full object-cover" />
        </div>
      </div>

      {looks.length > 0 && (
        <section aria-labelledby="looks-heading" className="flex flex-col gap-2">
          <h2 id="looks-heading" className="text-sm font-semibold">
            Looks you&apos;ve tried
          </h2>
          <ul className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
            {looks.map((look) => (
              <li key={look.id} className="w-28 shrink-0">
                <Link href={`/app/render/${look.id}`} className="flex flex-col gap-1">
                  <span className="rounded-control bg-surface-sunken block aspect-[4/3] overflow-hidden">
                    {look.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                      <img src={look.imageUrl} alt="" className="h-full w-full object-cover" />
                    )}
                  </span>
                  <span className="truncate text-xs font-medium">{look.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RestyleChooser roomId={room.id} colors={colors} balance={balances.total} />
    </>
  )
}

function RoomPlaceholder() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <div className="bg-surface-sunken h-10 w-2/3 rounded-full" />
      <div className="rounded-card bg-surface-sunken aspect-[4/3]" />
      <div className="bg-surface-sunken h-12 rounded-full" />
    </div>
  )
}
