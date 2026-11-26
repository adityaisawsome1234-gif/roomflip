import {
  CUSTOM_STYLE,
  MATERIAL_TARGETS,
  PAINT_SURFACES,
  STYLE_PRESETS,
  type MaterialTarget,
  type PaintSurface,
  type StylePresetId,
} from '@/lib/config/styles'

/**
 * Turns a restyle choice into the instruction sent to the image model.
 *
 * Every prompt has the same three parts: what to change, what must not change
 * (the room's geometry and the camera), and what the result must look like
 * (a real photograph). The preservation block is fixed text, so every mode and
 * every model gets the same guarantees.
 *
 * Pure: no I/O, so it is unit tested directly.
 */

export type RestyleSpec =
  | { mode: 'style'; preset: StylePresetId }
  | { mode: 'style'; custom: string }
  | {
      mode: 'paint'
      color: { brand: string; name: string; code: string; hex: string }
      surfaces: PaintSurface[]
    }
  | { mode: 'material'; target: MaterialTarget }

/** What each input image is. The provider receives the images in this order. */
export type ImageRole = 'room' | 'preview' | 'swatch'

export interface BuiltPrompt {
  prompt: string
  images: ImageRole[]
}

const ORDINALS = ['first', 'second', 'third'] as const

const BRAND_NAMES: Record<string, string> = {
  benjamin_moore: 'Benjamin Moore',
  sherwin_williams: 'Sherwin-Williams',
}

export const PRESERVE_ROOM = [
  'Keep the room itself exactly as it is: the same walls, ceiling and floor area, every window and',
  'door in the same place and at the same size, the same architecture and layout, and the same',
  'camera position, angle, height, lens and framing. Do not add, remove, move or resize windows,',
  'doors, walls, beams, columns, stairs, radiators or built-in fixtures. Do not crop, zoom, rotate,',
  'mirror or change the perspective. Keep the daylight coming from the same windows, in the same',
  'direction.',
].join(' ')

export const PHOTOREALISM = [
  'The result must look like a real interior photograph taken with the same camera: realistic',
  'materials and textures, natural light and shadows, correct reflections. No text, labels,',
  'logos, watermarks, people or pets, and no illustration, painting or 3D-render look.',
].join(' ')

/** Clean up the free-text style so it cannot break the prompt's structure. */
export function sanitizeCustomStyle(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/["“”`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CUSTOM_STYLE.maxLength)
}

/** "walls" + "ceiling" -> "all of the walls and the ceiling" */
function listSurfaces(surfaces: PaintSurface[]): string {
  const parts = [...new Set(surfaces)].map((surface) => PAINT_SURFACES[surface].prompt)
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

function roomLabel(roomType: string | null | undefined): string {
  const cleaned = roomType ? sanitizeCustomStyle(roomType).toLowerCase().slice(0, 40) : ''
  return cleaned || 'room'
}

/** The "what to change" sentence for a spec, referring to images by position. */
function changeInstruction(spec: RestyleSpec, ref: (role: ImageRole) => string): string {
  switch (spec.mode) {
    case 'style': {
      const style =
        'preset' in spec
          ? STYLE_PRESETS[spec.preset].prompt
          : `this style, as described by the owner: '${sanitizeCustomStyle(spec.custom)}'`
      return [
        `Redecorate the room in ${ref('room')} in ${style}.`,
        'Change the furniture, soft furnishings, decor, light fixtures and wall colour to suit the',
        'style. Keep the main pieces of furniture in roughly the same places so the room still',
        'works, and keep the flooring unless the style clearly calls for a different one.',
      ].join(' ')
    }
    case 'paint': {
      const { color } = spec
      const brand = BRAND_NAMES[color.brand] ?? color.brand
      return [
        `Repaint ${listSurfaces(spec.surfaces)} in ${ref('room')} in ${brand} ${color.name}`,
        `(${color.code}), the colour ${color.hex.toUpperCase()}, with a realistic matte or eggshell`,
        'finish. Show the colour as it would really look in this light: shadowed areas darker,',
        'sunlit areas lighter. Change nothing else: furniture, decor, flooring, fixtures and every',
        'surface not listed stay exactly as they are.',
      ].join(' ')
    }
    case 'material': {
      const target = MATERIAL_TARGETS[spec.target]
      return [
        `${capitalize(ref('swatch'))} is a close-up photo of a material sample (fabric, tile or`,
        `flooring). Apply that exact material, with its colour, pattern, texture and scale, to`,
        `${target.prompt} in ${ref('room')}. Scale the pattern realistically for the size of the`,
        'object. Change nothing else in the room.',
      ].join(' ')
    }
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Build the prompt and the order of the input images.
 *
 * preview: the room photo (plus the swatch in material mode).
 * hd:      the room photo, then the chosen preview (plus the swatch). The model
 *          is asked to reproduce the approved preview faithfully, at full
 *          quality, on the original geometry.
 */
export function buildPrompt(input: {
  spec: RestyleSpec
  tier: 'preview' | 'hd'
  roomType?: string | null
}): BuiltPrompt {
  const { spec, tier } = input
  const images: ImageRole[] = ['room']
  if (tier === 'hd') images.push('preview')
  if (spec.mode === 'material') images.push('swatch')

  const ref = (role: ImageRole) => `the ${ORDINALS[images.indexOf(role)]} image`
  const room = roomLabel(input.roomType)

  const parts =
    tier === 'preview'
      ? [`This is a photo of a ${room}.`, changeInstruction(spec, ref)]
      : [
          `The first image is a photo of a ${room}. The second image is an approved redesign of`,
          'that same room. Reproduce the second image faithfully, with the same furniture,',
          'materials, colours, decor and lighting, at the highest quality and detail, on the exact',
          'geometry and camera framing of the first image. Fix any distortions in the second image.',
          `The redesign was made with this instruction: ${changeInstruction(spec, ref)}`,
        ]

  return { prompt: [...parts, PRESERVE_ROOM, PHOTOREALISM].join(' '), images }
}
