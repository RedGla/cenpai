import { describe, expect, it } from 'vitest'
import { extensionFor, pickMimeType } from './record'

describe('pickMimeType', () => {
  it('prefers MP4 when it is supported', () => {
    expect(pickMimeType(() => true)).toMatch(/^video\/mp4/)
  })

  it('falls back to WebM when MP4 is not supported', () => {
    expect(pickMimeType((t) => t.startsWith('video/webm'))).toMatch(/^video\/webm/)
  })

  it('returns null when nothing is supported', () => {
    expect(pickMimeType(() => false)).toBeNull()
  })

  it('picks the file extension from the type', () => {
    expect(extensionFor('video/mp4;codecs=avc1')).toBe('mp4')
    expect(extensionFor('video/webm;codecs=vp9')).toBe('webm')
  })
})
