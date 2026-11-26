import { z } from 'zod'
import {
  CUSTOM_STYLE,
  MATERIAL_TARGET_IDS,
  PAINT_SURFACE_IDS,
  STYLE_PRESET_IDS,
} from '@/lib/config/styles'
import { sanitizeCustomStyle } from './prompt'

/**
 * What a browser may send to start a render. Everything is validated here;
 * ids are checked against the database (ownership, existence) by the job runner.
 */

const styleChoice = z.union([
  z.object({ mode: z.literal('style'), preset: z.enum(STYLE_PRESET_IDS) }).strict(),
  z
    .object({
      mode: z.literal('style'),
      custom: z
        .string()
        .transform(sanitizeCustomStyle)
        .pipe(z.string().min(CUSTOM_STYLE.minLength).max(CUSTOM_STYLE.maxLength)),
    })
    .strict(),
])

const paintChoice = z
  .object({
    mode: z.literal('paint'),
    paintColorId: z.number().int().positive(),
    surfaces: z
      .array(z.enum(PAINT_SURFACE_IDS))
      .min(1)
      .max(PAINT_SURFACE_IDS.length)
      .transform((surfaces) => [...new Set(surfaces)]),
  })
  .strict()

const materialChoice = z
  .object({
    mode: z.literal('material'),
    swatchId: z.uuid(),
    target: z.enum(MATERIAL_TARGET_IDS),
  })
  .strict()

export const restyleChoiceSchema = z.union([styleChoice, paintChoice, materialChoice])
export type RestyleChoice = z.infer<typeof restyleChoiceSchema>

export const renderRequestSchema = z.discriminatedUnion('tier', [
  // A new look (or a regeneration) for a room.
  z
    .object({
      tier: z.literal('preview'),
      roomId: z.uuid(),
      choice: restyleChoiceSchema,
      clientRequestId: z.uuid().optional(),
    })
    .strict(),
  // The HD final of a finished preview. Everything else is taken from that preview.
  z
    .object({
      tier: z.literal('hd'),
      sourceRenderId: z.uuid(),
      clientRequestId: z.uuid().optional(),
    })
    .strict(),
])

export type RenderRequest = z.infer<typeof renderRequestSchema>
