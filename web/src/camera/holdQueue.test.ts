import { describe, expect, it } from 'vitest'
import { HoldQueue, MAX_HELD, MAX_HOLD_MS } from './holdQueue'

const seqs = (h: { seq: number }[]) => h.map((x) => x.seq)

describe('HoldQueue', () => {
  it('shows nothing until a detection exists for the frame or a later one', () => {
    const q = new HoldQueue<string>()
    q.push('a', 0)
    q.push('b', 33)
    expect(q.take().show).toBeNull()
    q.markDetected(0)
    const r = q.take()
    expect(r.show?.item).toBe('a')
    expect(r.blurred).toBe(false)
    expect(q.take().show).toBeNull() // frame b still waits
  })

  it('a detection on a later frame releases the earlier ones too, oldest first', () => {
    const q = new HoldQueue<number>(6, 3)
    for (let i = 0; i < 3; i++) q.push(i, i * 33)
    q.markDetected(2)
    expect(q.take().show?.seq).toBe(0)
    expect(q.take().show?.seq).toBe(1)
    expect(q.take().show?.seq).toBe(2)
    expect(q.take().show).toBeNull()
  })

  it('skips older released frames so the delay stays short', () => {
    const q = new HoldQueue<number>(6, 2)
    for (let i = 0; i < 5; i++) q.push(i, i * 33)
    q.markDetected(4)
    const r = q.take()
    expect(seqs(r.recycle)).toEqual([0, 1, 2])
    expect(r.show?.seq).toBe(3)
    expect(q.take().show?.seq).toBe(4)
  })

  it('releases the oldest frame blurred once more than the hard cap are held', () => {
    const q = new HoldQueue<number>()
    for (let i = 0; i < MAX_HELD; i++) q.push(i, i)
    expect(q.take().show).toBeNull()
    q.push(MAX_HELD, MAX_HELD)
    const r = q.take()
    expect(r.show?.seq).toBe(0)
    expect(r.blurred).toBe(true)
    expect(q.length).toBe(MAX_HELD)
  })

  it('never shows a frame that is newer than the detection unblurred', () => {
    const q = new HoldQueue<number>()
    for (let i = 0; i < 20; i++) {
      q.push(i, i)
      if (i === 3) q.markDetected(3)
      const r = q.take()
      if (r.show && !r.blurred) expect(r.show.seq).toBeLessThanOrEqual(q.detectedSeq)
    }
  })

  it('hands back every frame it drops or drains, so none leak', () => {
    const q = new HoldQueue<number>()
    const out: number[] = []
    for (let i = 0; i < 12; i++) {
      q.push(i, i)
      if (i % 4 === 3) q.markDetected(i)
      const r = q.take()
      out.push(...seqs(r.recycle))
      if (r.show) out.push(r.show.seq)
    }
    out.push(...seqs(q.drain()))
    expect(out.sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i))
  })

  it('after a model change, held frames wait for the new detector', () => {
    const q = new HoldQueue<number>()
    q.push(0, 0)
    q.markDetected(0)
    q.resetDetections()
    q.push(1, 33)
    expect(q.take().show).toBeNull()
  })

  it('releases blurred by age: a frame waits at most 300 ms for a detection', () => {
    const q = new HoldQueue<number>()
    // 30 fps: 9 frames fit inside 300 ms, so none is released before that
    for (let i = 0; i < 9; i++) {
      q.push(i, i * 33)
      expect(q.take(i * 33).show).toBeNull()
    }
    q.push(9, 9 * 33)
    const r = q.take(MAX_HOLD_MS + 1)
    expect(r.show?.seq).toBe(0)
    expect(r.blurred).toBe(true)
  })

  it('skips to the newest too-old frame when several are past the age limit', () => {
    const q = new HoldQueue<number>()
    for (let i = 0; i < 5; i++) q.push(i, i * 100)
    const r = q.take(700) // frames 0..3 are older than 300 ms
    expect(r.show?.seq).toBe(3)
    expect(r.recycle.map((h) => h.seq)).toEqual([0, 1, 2])
  })

  it('waits longer for a slow detector once the hold limit is raised', () => {
    // Laptop case: the detection for a frame arrives about 300 ms after capture.
    const q = new HoldQueue<number>()
    q.setMaxHoldMs(450)
    q.push(0, 0)
    expect(q.take(320).show).toBeNull()
    q.markDetected(0)
    const r = q.take(330)
    expect(r.show?.seq).toBe(0)
    expect(r.blurred).toBe(false)
  })

  it('shows every released frame in turn when the releasable cap is raised', () => {
    const q = new HoldQueue<number>()
    q.setMaxReleasable(8)
    for (let i = 0; i < 6; i++) q.push(i, i * 50)
    q.markDetected(5)
    const shown = [0, 1, 2, 3, 4, 5].map(() => q.take(300).show?.seq)
    expect(shown).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('still releases blurred past the raised limit (fail closed)', () => {
    const q = new HoldQueue<number>()
    q.setMaxHoldMs(450)
    q.push(0, 0)
    const r = q.take(451)
    expect(r.show?.seq).toBe(0)
    expect(r.blurred).toBe(true)
  })
})
