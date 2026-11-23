import { describe, expect, it } from 'vitest'
import type { ReadyInfo } from '../detect/client'
import type { LiveStats } from './pipeline'
import { cameraErrorText, protectionStatus } from './protection'

const model = { interimMask: false } as ReadyInfo

function stats(over: Partial<LiveStats> = {}): LiveStats {
  return {
    fps: 20,
    shutter: false,
    plates: 0,
    inferMs: 140,
    loading: false,
    model,
    error: null,
    debug: '',
    held: 0,
    holdMs: 0,
    stability: '',
    trackRows: [],
    ...over,
  }
}

describe('protectionStatus', () => {
  it('is blurred while the model loads', () => {
    expect(protectionStatus(null).tone).toBe('warn')
    expect(protectionStatus(stats({ loading: true })).label).toMatch(/blurred/)
  })

  it('reports errors as not protecting', () => {
    expect(protectionStatus(stats({ error: 'x' })).tone).toBe('alert')
    expect(protectionStatus(null, 'blocked').label).toBe('Not protecting')
  })

  it('counts covered plates', () => {
    expect(protectionStatus(stats()).label).toBe('Watching for plates')
    expect(protectionStatus(stats({ plates: 1 })).label).toBe('Covering 1 plate')
    expect(protectionStatus(stats({ plates: 3 })).label).toBe('Covering 3 plates')
    expect(protectionStatus(stats({ plates: 1 })).tone).toBe('ok')
  })

  it('shows the shutter as blurred', () => {
    const p = protectionStatus(stats({ shutter: true, plates: 2 }))
    expect(p.label).toMatch(/blurred/)
    expect(p.tone).toBe('warn')
  })

  it('notes holding, interim threshold and slow inference', () => {
    const p = protectionStatus(
      stats({
        held: 3,
        holdMs: 142.4,
        inferMs: 400,
        model: { interimMask: true } as ReadyInfo,
      }),
    )
    expect(p.notes).toEqual(['Slowed down', 'Interim threshold', 'Holding 142 ms'])
    expect(p.tone).toBe('warn')
  })
})

describe('cameraErrorText', () => {
  it('explains a blocked permission', () => {
    expect(cameraErrorText(new DOMException('x', 'NotAllowedError'))).toMatch(
      /Allow the camera/,
    )
  })
  it('falls back to the message', () => {
    expect(cameraErrorText(new Error('boom'))).toMatch(/boom/)
  })
})
