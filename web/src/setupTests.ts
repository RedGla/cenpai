import '@testing-library/jest-dom/vitest'

// jsdom has no Worker. A silent stand-in keeps component tests off the real detector.
class FakeWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: ErrorEvent) => void) | null = null
  postMessage() {}
  terminate() {}
}
globalThis.Worker = FakeWorker as unknown as typeof Worker
