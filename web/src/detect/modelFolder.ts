/**
 * Which model folder to load. The shipped model lives in `models/plate-<size>/`; a developer
 * URL parameter `?model=<id>` picks another locked model from an allow-list, for the phone test
 * (see docs/protocols/data_and_phone_test.md). Unknown ids fall back to the shipped model.
 */
const EXTRA_MODELS = ['r1c'] as const
export type ModelId = 'plate' | (typeof EXTRA_MODELS)[number]

export function modelIdFrom(search: string): ModelId {
  const id = new URLSearchParams(search).get('model')
  return (EXTRA_MODELS as readonly string[]).includes(id ?? '') ? (id as ModelId) : 'plate'
}

export function modelDir(base: string, id: ModelId, size: 640 | 416): string {
  return `${base}models/${id}-${size}/`
}
