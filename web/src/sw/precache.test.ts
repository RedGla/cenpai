import { expect, it } from 'vitest'
import { precacheList, renderServiceWorker } from './precache'

it('lists the start page, bundle files and public files, without maps or the worker itself', () => {
  const list = precacheList(
    ['index.html', 'assets/index-a.js', 'assets/index-a.js.map', 'assets/ort-b.wasm'],
    ['models/plate-640/plate_640.onnx', 'models\\plate-416\\MODEL.json', 'sw.js'],
  )
  expect(list).toEqual([
    '',
    'assets/index-a.js',
    'assets/ort-b.wasm',
    'models/plate-416/MODEL.json',
    'models/plate-640/plate_640.onnx',
  ])
})

it('fills both placeholders in the template', () => {
  const out = renderServiceWorker(
    'const F = __PRECACHE__; const V = __VERSION__',
    ['', 'a.js'],
    'abc',
  )
  expect(out).toBe('const F = ["","a.js"]; const V = "abc"')
  expect(() => renderServiceWorker('nothing here', [], 'x')).toThrow()
})
