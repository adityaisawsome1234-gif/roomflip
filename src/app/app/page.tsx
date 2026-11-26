import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { PhotoPicker } from '@/components/restyle/photo-picker'
import { getSessionUser } from '@/lib/auth/session'
import { listRecentRooms } from '@/lib/rooms-data'

export const metadata: Metadata = { title: 'Create' }

/** Create tab: start from a new photo, or pick up a room from before. */
export default function CreatePage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-4xl leading-tight tracking-tight">Restyle a room</h1>
        <p className="text-muted">Add a photo of your room, then pick a new look for it.</p>
      </div>
      <PhotoPicker />
      <Suspense fallback={null}>
        <RecentRooms />
      </Suspense>
    </div>
  )
}

async function RecentRooms() {
  const user = await getSessionUser()
  if (!user) return null
  const rooms = await listRecentRooms(user.id, 6)
  if (rooms.length === 0) return null

  return (
    <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
      <h2 id="recent-heading" className="text-sm font-semibold">
        Or restyle a room from before
      </h2>
      <ul className="grid grid-cols-3 gap-2">
        {rooms.map((room) => (
          <li key={room.id}>
            <Link
              href={`/app/room/${room.id}`}
              aria-label={`Restyle ${room.roomType?.toLowerCase() ?? 'room'} from ${new Date(room.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
              className="rounded-control bg-surface-sunken block aspect-square overflow-hidden"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
              <img src={room.photoUrl} alt="" className="h-full w-full object-cover" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
