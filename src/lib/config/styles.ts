/**
 * What the user can choose in each restyle mode. The `prompt` text is what the
 * image model sees; `label` and `blurb` are what people see.
 */

export const STYLE_PRESETS = {
  modern: {
    label: 'Modern',
    blurb: 'Clean lines, neutral tones, no clutter',
    prompt:
      'modern: clean lines, low-profile furniture, a restrained neutral palette of white, grey and ' +
      'black with one or two muted accents, sleek metal and lacquer finishes, minimal decor',
  },
  japandi: {
    label: 'Japandi',
    blurb: 'Calm, natural wood, soft neutrals',
    prompt:
      'Japandi: a calm blend of Japanese and Scandinavian design, light and mid-tone natural wood, ' +
      'linen and paper textures, low furniture, warm beige, greige and soft black, very little decor, ' +
      'a ceramic vase or bonsai, soft diffused light',
  },
  scandinavian: {
    label: 'Scandinavian',
    blurb: 'Bright, airy, light wood and wool',
    prompt:
      'Scandinavian: bright and airy, white and pale grey walls and textiles, light oak or ash ' +
      'furniture, wool throws and sheepskin, simple pendant lights, green plants, cosy but uncluttered',
  },
  midcentury: {
    label: 'Mid-century',
    blurb: 'Walnut, tapered legs, warm retro colours',
    prompt:
      'mid-century modern: walnut and teak furniture with tapered legs, organic curved shapes, ' +
      'mustard, teal, burnt orange and olive accents, a sputnik or arc floor lamp, graphic retro textiles',
  },
  coastal: {
    label: 'Coastal',
    blurb: 'Breezy whites, blues and natural fibres',
    prompt:
      'coastal: breezy and light, crisp white and sandy beige with soft ocean blues, rattan and ' +
      'jute, whitewashed wood, linen slipcovers, striped cushions, simple beach-inspired decor',
  },
  industrial: {
    label: 'Industrial',
    blurb: 'Raw metal, leather, reclaimed wood',
    prompt:
      'industrial: black steel and iron, reclaimed and dark-stained wood, cognac leather seating, ' +
      'Edison-bulb and caged pendant lights, concrete-look surfaces, a dark, moody, warm palette',
  },
  traditional: {
    label: 'Traditional',
    blurb: 'Classic, elegant, rich wood and fabrics',
    prompt:
      'traditional: classic, elegant furniture with carved dark wood, rolled-arm upholstered sofas, ' +
      'rich fabrics such as velvet and damask, a Persian-style rug, brass table lamps, symmetrical ' +
      'arrangement, warm cream, burgundy and navy',
  },
  boho: {
    label: 'Boho',
    blurb: 'Layered, plants, pattern and texture',
    prompt:
      'bohemian: relaxed and layered, many green plants, macrame and woven wall hangings, rattan ' +
      'and cane furniture, patterned kilim rugs, floor cushions, warm terracotta, mustard and rust tones',
  },
} as const

export type StylePresetId = keyof typeof STYLE_PRESETS
export const STYLE_PRESET_IDS = Object.keys(STYLE_PRESETS) as StylePresetId[]

/** Limits for the free-text style option. */
export const CUSTOM_STYLE = { minLength: 3, maxLength: 200 } as const

/** Surfaces paint can go on, in the order they are offered. */
export const PAINT_SURFACES = {
  walls: { label: 'All walls', prompt: 'all of the walls' },
  accent_wall: {
    label: 'Accent wall',
    prompt:
      'only the main wall facing the camera (an accent wall), leaving the other walls as they are',
  },
  ceiling: { label: 'Ceiling', prompt: 'the ceiling' },
  trim: {
    label: 'Trim',
    prompt: 'the trim: baseboards, window frames, door frames and crown moulding',
  },
  cabinets: { label: 'Cabinets', prompt: 'the cabinet doors and drawer fronts' },
  doors: { label: 'Doors', prompt: 'the interior doors' },
} as const

export type PaintSurface = keyof typeof PAINT_SURFACES
export const PAINT_SURFACE_IDS = Object.keys(PAINT_SURFACES) as PaintSurface[]

/** Where an uploaded fabric, tile or flooring sample can go. */
export const MATERIAL_TARGETS = {
  curtains: {
    label: 'Curtains',
    prompt:
      'the curtains or drapes on the windows (if the windows have none, add simple floor-length ' +
      'curtains made from it)',
  },
  sofa: { label: 'Sofa', prompt: 'the upholstery of the sofa, re-covering it in this fabric' },
  rug: {
    label: 'Rug',
    prompt: 'the area rug (if there is none, add a rug under the main seating or bed area)',
  },
  floor: {
    label: 'Floor',
    prompt:
      'the whole floor surface, laid realistically at the correct scale and following the ' +
      'perspective of the room',
  },
  backsplash: {
    label: 'Backsplash',
    prompt:
      'the kitchen backsplash: the wall area between the countertop and the upper cabinets, ' +
      'tiled at a realistic scale',
  },
} as const

export type MaterialTarget = keyof typeof MATERIAL_TARGETS
export const MATERIAL_TARGET_IDS = Object.keys(MATERIAL_TARGETS) as MaterialTarget[]
