// Copy the onnxruntime-web runtime files into public/ort/ so the app serves them itself
// (no CDN, works offline). public/ort/ is gitignored; this runs before dev and build.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'onnxruntime-web', 'dist')
const dst = join(root, 'public', 'ort')
// The onnxruntime-web/webgpu build uses this one binary for both WebGPU and WebAssembly.
// Its loader script is built into the bundle, so only the .wasm is served from here.
const files = ['ort-wasm-simd-threaded.asyncify.wasm']

mkdirSync(dst, { recursive: true })
for (const f of files) {
  if (!existsSync(join(src, f))) throw new Error(`missing ${f} in onnxruntime-web; run npm ci`)
  copyFileSync(join(src, f), join(dst, f))
}
console.log(`copied ${files.length} onnxruntime-web files to public/ort/`)
