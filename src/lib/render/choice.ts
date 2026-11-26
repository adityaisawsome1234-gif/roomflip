import {
  MATERIAL_TARGETS,
  PAINT_SURFACES,
  STYLE_PRESETS,
  type MaterialTarget,
  type PaintSurface,
  type StylePresetId,
} from '@/lib/config/styles'
import type { RestyleChoice } from './request'

/**
 * Converting between what a render stores (mode + params) and what the
 * browser sends (a choice), plus short human labels. Pure and client-safe.
 */

type Params = Record<string, unknown> | null | undefined

/** The choice that produced a render, so "Regenerate" can send it again. */
export function choiceFromParams(mode: string, params: Params): RestyleChoice | null {
  const p = params ?? {}
  if (mode === 'style' && typeof p.preset === 'string' && p.preset in STYLE_PRESETS) {
    return { mode: 'style', preset: p.preset as StylePresetId }
  }
  if (mode === 'style' && typeof p.custom === 'string') return { mode: 'style', custom: p.custom }
  if (mode === 'paint' && typeof p.paintColorId === 'number' && Array.isArray(p.surfaces)) {
    return { mode: 'paint', paintColorId: p.paintColorId, surfaces: p.surfaces as PaintSurface[] }
  }
  if (mode === 'material' && typeof p.swatchId === 'string' && typeof p.target === 'string') {
    return { mode: 'material', swatchId: p.swatchId, target: p.target as MaterialTarget }
  }
  return null
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}

/** "Japandi", "White Dove on the walls", "New fabric on the sofa". */
export function describeChoice(mode: string, params: Params): string {
  const p = params ?? {}
  if (mode === 'style') {
    if (typeof p.preset === 'string' && p.preset in STYLE_PRESETS) {
      return STYLE_PRESETS[p.preset as StylePresetId].label
    }
    if (typeof p.custom === 'string') {
      const text = p.custom.trim()
      return text.length > 40 ? `${text.slice(0, 39)}…` : text
    }
  }
  if (mode === 'paint') {
    const color = p.color as { name?: string } | undefined
    const surfaces = (Array.isArray(p.surfaces) ? p.surfaces : [])
      .filter((s): s is PaintSurface => typeof s === 'string' && s in PAINT_SURFACES)
      .map((s) => PAINT_SURFACES[s].label.toLowerCase())
    const where = surfaces.length ? ` on ${joinLabels(surfaces)}` : ''
    return `${color?.name ?? 'New paint'}${where}`
  }
  if (mode === 'material' && typeof p.target === 'string' && p.target in MATERIAL_TARGETS) {
    return `New ${MATERIAL_TARGETS[p.target as MaterialTarget].label.toLowerCase()}`
  }
  return 'Restyle'
}
