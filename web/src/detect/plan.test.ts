import { describe, expect, it } from 'vitest'
import { START_TIMEOUT_MS, THREADED_START_TIMEOUT_MS, startPlan, threadCount } from './plan'

const brief = (p: ReturnType<typeof startPlan>) => p.map((a) => `${a.backend}-${a.size}-${a.threads}`)

describe('startPlan', () => {
  it('auto: WebGPU 640, then threaded WebAssembly 416, then single-threaded 416', () => {
    expect(brief(startPlan('auto', 'auto', 4))).toEqual(['webgpu-640-1', 'wasm-416-4', 'wasm-416-1'])
  })

  it('skips the threaded try when only one thread is available', () => {
    expect(brief(startPlan('auto', 'auto', 1))).toEqual(['webgpu-640-1', 'wasm-416-1'])
  })

  it('honours a forced backend and an explicit size', () => {
    expect(brief(startPlan('wasm', 'auto', 4))).toEqual(['wasm-416-4', 'wasm-416-1'])
    expect(brief(startPlan('webgpu', 'auto', 4))).toEqual(['webgpu-640-1'])
    expect(brief(startPlan('auto', 416, 2))).toEqual(['webgpu-416-1', 'wasm-416-2', 'wasm-416-1'])
  })

  it('gives a threaded start a shorter time limit', () => {
    const p = startPlan('wasm', 'auto', 4)
    expect(p[0].timeoutMs).toBe(THREADED_START_TIMEOUT_MS)
    expect(p[1].timeoutMs).toBe(START_TIMEOUT_MS)
  })
})

describe('threadCount', () => {
  it('needs cross-origin isolation, uses half the cores, at most 4', () => {
    expect(threadCount(false, 8)).toBe(1)
    expect(threadCount(true, 8)).toBe(4)
    expect(threadCount(true, 4)).toBe(2)
    expect(threadCount(true, 16)).toBe(4)
    expect(threadCount(true, undefined)).toBe(1)
  })
})
