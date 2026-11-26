import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { apiUser, json, jsonError } from '@/lib/api'
import { canUseDevTools } from '@/lib/auth/admin'
import { getModel, isModelId, renderCostUsd } from '@/lib/config/models'
import { optionalServerEnv } from '@/lib/env.server'
import { processUpload, UPLOAD_LIMITS } from '@/lib/images/process'
import { moderateImage } from '@/lib/moderation'
import { buildPrompt, type RestyleSpec } from '@/lib/render/prompt'
import { getProvider } from '@/lib/render/providers'
import { sizeRequest } from '@/lib/render/providers/sizing'
import { restyleChoiceSchema } from '@/lib/render/request'
import { createAdminClient } from '@/lib/supabase/admin'
import { BUCKETS, putObject, signedUrl, userPath } from '@/lib/storage'
import { uploadErrorResponse } from '@/lib/upload-errors'

export const maxDuration = 60

const modelsSchema = z.array(z.string()).min(1).max(8)

async function readImage(form: FormData, field: string): Promise<Buffer | null> {
  const entry = form.get(field)
  if (!(entry instanceof Blob) || entry.size === 0) return null
  if (entry.size > UPLOAD_LIMITS.maxBytes) throw new Error('too large')
  return Buffer.from(await entry.arrayBuffer())
}

/**
 * Developer tool: send one photo and one restyle choice to several models at
 * once. Calls providers directly, without renders or credits. Returns one
 * submitted job (or an error) per model; poll /api/dev/compare/status.
 */
export async function POST(request: Request) {
  const user = await apiUser()
  if (user instanceof Response) return user
  if (!canUseDevTools(user)) return jsonError(403, 'forbidden', 'Developer tools are admin-only.')

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return jsonError(400, 'bad_request', 'Send a multipart form.')
  }

  const choiceRaw = form.get('choice')
  const modelsRaw = form.get('models')
  const choice = restyleChoiceSchema.safeParse(JSON.parse(String(choiceRaw ?? 'null')))
  const models = modelsSchema.safeParse(JSON.parse(String(modelsRaw ?? 'null')))
  if (!choice.success || !models.success)
    return jsonError(400, 'invalid_request', 'Bad choice or models.')

  try {
    const photoFile = await readImage(form, 'photo')
    if (!photoFile) return jsonError(400, 'missing_file', 'Add a room photo.')
    const photo = await processUpload(photoFile)
    const moderation = await moderateImage(photo.data)
    if (moderation.outcome === 'flagged') return jsonError(422, 'flagged', 'Photo was flagged.')

    const runId = randomUUID()
    const roomObject = {
      bucket: BUCKETS.originals,
      path: userPath(user.id, `compare/${runId}.jpg`),
    }
    await putObject(roomObject, photo.data, photo.mimeType)
    const imageUrls = [await signedUrl(roomObject, 3600)]

    let spec: RestyleSpec
    const c = choice.data
    if (c.mode === 'paint') {
      const { data: color } = await createAdminClient()
        .from('paint_colors')
        .select('brand, name, code, hex')
        .eq('id', c.paintColorId)
        .single()
      if (!color) return jsonError(400, 'unknown_color', 'Unknown colour.')
      spec = { mode: 'paint', color, surfaces: c.surfaces }
    } else if (c.mode === 'material') {
      const swatchFile = await readImage(form, 'swatch')
      if (!swatchFile)
        return jsonError(400, 'missing_file', 'Add a swatch photo for material mode.')
      const swatch = await processUpload(swatchFile)
      const swatchObject = {
        bucket: BUCKETS.swatches,
        path: userPath(user.id, `compare/${runId}.jpg`),
      }
      await putObject(swatchObject, swatch.data, swatch.mimeType)
      imageUrls.push(await signedUrl(swatchObject, 3600))
      spec = { mode: 'material', target: c.target }
    } else {
      spec = c
    }
    const { prompt } = buildPrompt({ spec, tier: 'preview' })

    const jobs = await Promise.all(
      models.data.map(async (id) => {
        if (!isModelId(id)) return { modelId: id, error: 'Unknown model' }
        const model = getModel(id)
        const base = {
          modelId: id,
          label: model.label,
          costUsd: renderCostUsd(model, imageUrls.length),
          priceIsEstimate: model.priceIsEstimate,
          priceIsTentative: model.priceIsTentative,
        }
        if (model.provider === 'fal' && !optionalServerEnv('FAL_KEY')) {
          return { ...base, error: 'FAL_KEY is not set' }
        }
        try {
          const submitted = await getProvider(model.provider).submit(
            model,
            {
              prompt,
              imageUrls,
              size: sizeRequest(model.sizing, photo.width, photo.height, 'preview'),
            },
            {},
          )
          return { ...base, provider: model.provider, ...submitted, submittedAt: Date.now() }
        } catch (error) {
          return { ...base, error: (error as Error).message }
        }
      }),
    )
    return json({ prompt, jobs })
  } catch (error) {
    const response = uploadErrorResponse(error)
    if (response) return response
    return jsonError(500, 'server_error', (error as Error).message)
  }
}
