import { expect, it } from 'vitest'
import { initialOptions } from './CameraTab'

it('reads size and backend from the address and ignores unknown values', () => {
  expect(initialOptions('')).toEqual({ size: 'auto', backend: 'auto' })
  expect(initialOptions('?size=416&backend=wasm')).toEqual({ size: 416, backend: 'wasm' })
  expect(initialOptions('?size=640')).toEqual({ size: 640, backend: 'auto' })
  expect(initialOptions('?size=300&backend=gpu')).toEqual({ size: 'auto', backend: 'auto' })
})
