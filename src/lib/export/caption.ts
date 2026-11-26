import {
  MATERIAL_TARGETS,
  STYLE_PRESETS,
  type MaterialTarget,
  type StylePresetId,
} from '@/lib/config/styles'

/**
 * The words on the reel: "My living room" / "→ Japandi" / "in 14 seconds".
 * The time is the render's real duration, so the claim is always true; it is
 * left out when the render took a minute or more. Pure, for unit tests.
 */
export interface ReelCaption {
  room: string
  look: string
  speed: string | null
}

const MAX_LOOK_LENGTH = 28

function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

export function reelCaption(input: {
  roomType: string | null | undefined
  mode: string
  params: Record<string, unknown> | null | undefined
  seconds: number | null | undefined
}): ReelCaption {
  const room = input.roomType?.trim() ? `My ${input.roomType.trim().toLowerCase()}` : 'My room'
  const p = input.params ?? {}

  let look = 'A new look'
  if (input.mode === 'style' && typeof p.preset === 'string' && p.preset in STYLE_PRESETS) {
    look = STYLE_PRESETS[p.preset as StylePresetId].label
  } else if (input.mode === 'style' && typeof p.custom === 'string' && p.custom.trim()) {
    look = shorten(p.custom.charAt(0).toUpperCase() + p.custom.slice(1), MAX_LOOK_LENGTH)
  } else if (input.mode === 'paint') {
    const name = (p.color as { name?: unknown } | undefined)?.name
    if (typeof name === 'string' && name) look = shorten(name, MAX_LOOK_LENGTH)
  } else if (
    input.mode === 'material' &&
    typeof p.target === 'string' &&
    p.target in MATERIAL_TARGETS
  ) {
    look = `A new ${MATERIAL_TARGETS[p.target as MaterialTarget].label.toLowerCase()}`
  }

  const seconds = input.seconds == null ? null : Math.max(1, Math.round(input.seconds))
  const speed =
    seconds !== null && seconds < 60
      ? `in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
      : null
  return { room, look, speed }
}
