import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Images } from 'lucide-react'
import { buttonClasses } from '@/components/ui/button'
import { requireUser } from '@/lib/auth/session'
import { ROUTES } from '@/lib/config/site'
import { listRecentRooms, listSavedRenders } from '@/lib/rooms-data'

export const metadata: Metadata = { title: 'My rooms' }

/** My rooms: saved before-and-afters, and the photos they came from. */
export default function RoomsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="font-display text-4xl leading-tight tracking-tight">My rooms</h1>
      <Suspense fallback={<GridPlaceholder />}>
        <Rooms />
      </Suspense>
    </div>
  )
}

async function Rooms() {
  const user = await requireUser(ROUTES.rooms)
  const [saved, rooms] = await Promise.all([
    listSavedRenders(user.id),
    listRecentRooms(user.id, 12),
  ])

  if (saved.length === 0 && rooms.length === 0) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-6 py-8 text-center">
        <span className="bg-surface-sunken text-muted flex size-16 items-center justify-center rounded-full">
          <Images aria-hidden="true" className="size-7" />
        </span>
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">No rooms yet</h2>
          <p className="text-muted">Saved before-and-afters will appear here.</p>
        </div>
        <Link href={ROUTES.app} className={buttonClasses({ variant: 'accent', size: 'lg' })}>
          Restyle a room
        </Link>
      </section>
    )
  }

  return (
    <>
      <section aria-labelledby="saved-heading" className="flex flex-col gap-3">
        <h2 id="saved-heading" className="text-lg font-semibold">
          Saved looks
        </h2>
        {saved.length === 0 ? (
          <p className="text-muted text-sm">
            Tap Save on a result you like and it will be kept here.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {saved.map((render) => (
              <li key={render.id}>
                <Link href={`/app/render/${render.id}`} className="flex flex-col gap-1.5">
                  <span className="rounded-control bg-surface-sunken block aspect-[4/3] overflow-hidden">
                    {render.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                      <img src={render.imageUrl} alt="" className="h-full w-full object-cover" />
                    )}
                  </span>
                  <span className="truncate text-sm font-medium">
                    {render.label}
                    {render.tier === 'hd' ? ' · HD' : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {rooms.length > 0 && (
        <section aria-labelledby="photos-heading" className="flex flex-col gap-3">
          <h2 id="photos-heading" className="text-lg font-semibold">
            Your photos
          </h2>
          <ul className="grid grid-cols-3 gap-2">
            {rooms.map((room) => (
              <li key={room.id}>
                <Link
                  href={`/app/room/${room.id}`}
                  aria-label={`New look for ${room.roomType?.toLowerCase() ?? 'this room'}`}
                  className="rounded-control bg-surface-sunken block aspect-square overflow-hidden"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                  <img src={room.photoUrl} alt="" className="h-full w-full object-cover" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function GridPlaceholder() {
  return (
    <div className="grid grid-cols-2 gap-3" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-control bg-surface-sunken aspect-[4/3]" />
      ))}
    </div>
  )
}
