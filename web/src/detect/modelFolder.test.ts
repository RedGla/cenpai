import { describe, expect, it } from 'vitest'
import { modelDir, modelIdFrom } from './modelFolder'

describe('modelIdFrom', () => {
  it('uses the shipped model by default', () => {
    expect(modelIdFrom('')).toBe('plate')
    expect(modelIdFrom('?video=1')).toBe('plate')
  })

  it('picks an allow-listed model', () => {
    expect(modelIdFrom('?video=1&model=v0')).toBe('v0')
  })

  it('ignores unknown or path-like ids', () => {
    expect(modelIdFrom('?model=../../etc')).toBe('plate')
    expect(modelIdFrom('?model=V0')).toBe('plate')
    expect(modelIdFrom('?model=r1c')).toBe('plate')
  })
})

describe('modelDir', () => {
  it('builds the folder from id and size', () => {
    expect(modelDir('/', 'plate', 640)).toBe('/models/plate-640/')
    expect(modelDir('/app/', 'v0', 416)).toBe('/app/models/v0-416/')
  })
})
