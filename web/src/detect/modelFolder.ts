/**
 * Which model folder to load. The shipped model (R1c since decision 32) lives in
 * `models/plate-<size>/`; a URL parameter `?model=<id>` picks another locked model from an
 * allow-list (`?model=v0` loads the previous v0 detector). Unknown ids fall back to the shipped model.
 */
const EXTRA_MODELS = ['v0'] as const
export type ModelId = 'plate' | (typeof EXTRA_MODELS)[number]

export function modelIdFrom(search: string): ModelId {
  const id = new URLSearchParams(search).get('model')
  return (EXTRA_MODELS as readonly string[]).includes(id ?? '') ? (id as ModelId) : 'plate'
}

export function modelDir(base: string, id: ModelId, size: 640 | 416): string {
  return `${base}models/${id}-${size}/`
}
