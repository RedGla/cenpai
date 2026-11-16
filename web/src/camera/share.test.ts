import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareFile, timestampName } from './share'

const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' })

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(navigator, 'canShare')
})

describe('shareFile', () => {
  it('reports unsupported when the browser has no share sheet', async () => {
    expect(await shareFile(file, 't')).toBe('unsupported')
  })

  it('reports unsupported when files cannot be shared', async () => {
    Object.assign(navigator, { share: vi.fn(), canShare: () => false })
    expect(await shareFile(file, 't')).toBe('unsupported')
  })

  it('shares the file and treats a cancelled sheet as cancelled', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { share, canShare: () => true })
    expect(await shareFile(file, 't')).toBe('shared')
    expect(share).toHaveBeenCalledWith({ files: [file], title: 't' })
    share.mockRejectedValue(new DOMException('cancel', 'AbortError'))
    expect(await shareFile(file, 't')).toBe('cancelled')
  })
})

describe('timestampName', () => {
  it('builds a sortable file name', () => {
    expect(timestampName('cenpai', 'mp4')).toMatch(/^cenpai-\d{8}-\d{6}\.mp4$/)
  })
})
