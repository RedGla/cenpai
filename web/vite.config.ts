import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Cross-origin isolation lets onnxruntime-web run WebAssembly on several threads
// (SharedArrayBuffer). Everything the app loads is same-origin, so nothing is blocked.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, headers: isolation },
  preview: { headers: isolation },
  // onnxruntime-web loads its own runtime files; pre-bundling it would move them.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    globals: false,
  },
})
