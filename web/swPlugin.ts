/// <reference types="node" />
// Vite build plugin: writes dist/sw.js with every built file and every public file
// (both plate models included) in its precache list. The cache version is a hash of the
// file names and contents, so a new build replaces the old cache.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'
import { precacheList, renderServiceWorker } from './src/sw/precache'

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  )
}

export default function serviceWorker(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'cenpai-service-worker',
    apply: 'build',
    configResolved(c) {
      config = c
    },
    writeBundle(_options, bundle) {
      const outDir = resolve(config.root, config.build.outDir)
      const publicFiles = config.publicDir
        ? walk(config.publicDir).map((f) => relative(config.publicDir, f))
        : []
      const files = precacheList(Object.keys(bundle), publicFiles)
      const hash = createHash('sha256')
      for (const f of files) {
        hash.update(f)
        if (f) hash.update(readFileSync(join(outDir, f)))
      }
      const template = readFileSync(resolve(config.root, 'sw-template.js'), 'utf8')
      const sw = renderServiceWorker(template, files, hash.digest('hex').slice(0, 12))
      writeFileSync(join(outDir, 'sw.js'), sw)
      config.logger.info(`sw.js: ${files.length} files precached`)
    },
  }
}
