import 'server-only'

import { cacheLife } from 'next/cache'
import { getEntitlement } from '@/lib/credits/entitlement'
import { describeChoice } from '@/lib/render/choice'
import { createAdminClient } from '@/lib/supabase/admin'
import { BUCKETS, type Bucket } from '@/lib/storage'

/**
 * Read models for the signed-in screens. Every function takes a user id that
 * the caller has verified, and scopes every query to it.
 */

const URL_TTL_SECONDS = 60 * 60

async function signMany(bucket: Bucket, paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const { data } = await createAdminClient()
    .storage.from(bucket)
    .createSignedUrls(unique, URL_TTL_SECONDS)
  const map = new Map<string, string>()
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) map.set(entry.path, entry.signedUrl)
  }
  return map
}

export interface RoomSummary {
  id: string
  roomType: string | null
  width: number
  height: number
  photoUrl: string
  createdAt: string
}

export async function getOwnedRoom(userId: string, roomId: string): Promise<RoomSummary | null> {
  const { data: room } = await createAdminClient()
    .from('rooms')
    .select('id, room_type, width, height, original_path, created_at')
    .eq('id', roomId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!room) return null
  const urls = await signMany(BUCKETS.originals, [room.original_path])
  return {
    id: room.id,
    roomType: room.room_type,
    width: room.width,
    height: room.height,
    photoUrl: urls.get(room.original_path) ?? '',
    createdAt: room.created_at,
  }
}

export async function listRecentRooms(userId: string, limit = 6): Promise<RoomSummary[]> {
  const { data } = await createAdminClient()
    .from('rooms')
    .select('id, room_type, width, height, original_path, created_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  const rooms = data ?? []
  const urls = await signMany(
    BUCKETS.originals,
    rooms.map((r) => r.original_path),
  )
  return rooms.map((room) => ({
    id: room.id,
    roomType: room.room_type,
    width: room.width,
    height: room.height,
    photoUrl: urls.get(room.original_path) ?? '',
    createdAt: room.created_at,
  }))
}

export interface RenderSummary {
  id: string
  roomId: string
  label: string
  status: string
  tier: string
  isSaved: boolean
  imageUrl: string | null
  width: number | null
  height: number | null
  createdAt: string
}

async function summarize(
  userId: string,
  rows: {
    id: string
    room_id: string
    mode: string
    params: unknown
    status: string
    tier: string
    is_saved: boolean
    result_path: string | null
    watermarked_path: string | null
    result_width: number | null
    result_height: number | null
    created_at: string
  }[],
): Promise<RenderSummary[]> {
  const paid = rows.length > 0 && (await getEntitlement(userId)) === 'paid'
  const pathOf = (row: (typeof rows)[number]) =>
    paid || !row.watermarked_path ? row.result_path : row.watermarked_path
  const urls = await signMany(
    BUCKETS.renders,
    rows
      .map((row) => (row.status === 'succeeded' ? pathOf(row) : null))
      .filter((p): p is string => !!p),
  )
  return rows.map((row) => {
    const path = row.status === 'succeeded' ? pathOf(row) : null
    return {
      id: row.id,
      roomId: row.room_id,
      label: describeChoice(row.mode, row.params as Record<string, unknown>),
      status: row.status,
      tier: row.tier,
      isSaved: row.is_saved,
      imageUrl: path ? (urls.get(path) ?? null) : null,
      width: row.result_width,
      height: row.result_height,
      createdAt: row.created_at,
    }
  })
}

const RENDER_COLUMNS =
  'id, room_id, mode, params, status, tier, is_saved, result_path, watermarked_path, result_width, result_height, created_at'

/** Recent looks for one room (previews only), newest first. */
export async function listRoomRenders(userId: string, roomId: string, limit = 12) {
  const { data } = await createAdminClient()
    .from('renders')
    .select(RENDER_COLUMNS)
    .eq('user_id', userId)
    .eq('room_id', roomId)
    .eq('tier', 'preview')
    .neq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(limit)
  return summarize(userId, data ?? [])
}

/** Everything the user saved to My Rooms, newest first. */
export async function listSavedRenders(userId: string, limit = 60) {
  const { data } = await createAdminClient()
    .from('renders')
    .select(RENDER_COLUMNS)
    .eq('user_id', userId)
    .eq('is_saved', true)
    .eq('status', 'succeeded')
    .order('created_at', { ascending: false })
    .limit(limit)
  return summarize(userId, data ?? [])
}

export interface PaintColor {
  id: number
  brand: 'benjamin_moore' | 'sherwin_williams'
  name: string
  code: string
  hex: string
  family: string
}

/** The paint catalog. Public and rarely changes, so it is cached. */
export async function getPaintCatalog(): Promise<PaintColor[]> {
  'use cache'
  cacheLife('days')
  const { data, error } = await createAdminClient()
    .from('paint_colors')
    .select('id, brand, name, code, hex, family')
    .eq('is_active', true)
    .order('brand')
    .order('sort_order')
  if (error) throw new Error(`Could not load paint colours: ${error.message}`)
  return (data ?? []) as PaintColor[]
}
