import path from 'node:path'

import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Windows drive-letter case bug (vite html-inline-proxy). When the project is
 * resolved from a lower-case CWD (`d:\AI Novel`), the build transform caches
 * inline <style> modules under a key derived from `config.root` (lower-case),
 * while rollup canonicalizes module ids to an upper-case drive letter (`D:`)
 * for the load hook. The cache-key lookup then misses and vite throws
 * "No matching HTML proxy module found".
 *
 * IMPORTANT: this may ONLY be applied during the production build. Rewriting
 * `root` also breaks vitest's module/mock registry (alias targets that resolve
 * to a different drive-letter case than the canonical root are no longer
 * intercepted by `vi.mock('@engine/...')`), so we pin the root in the
 * `config`/`buildStart` hook only — never in the exported `root` field.
 */
function canonicalRoot() {
  const root = path.resolve(__dirname)
  return root.replace(/^([a-zA-Z]):/, (_match, drive) => `${drive.toUpperCase()}:`)
}

const pinnedRoot = canonicalRoot()

// A tiny inline plugin that uppercases the resolved root for the *build* only.
// `config` runs before Vite's own html-inline-proxy load hook is set up, and
// leaving the exported `root` untouched keeps vitest/typecheck resolution
// identical to the pre-bug behaviour.
const pinRootForBuild = (): Plugin => ({
  name: 'pin-root-drive-letter-for-build',
  apply: 'build',
  config: () => ({ root: pinnedRoot }),
})

export default defineConfig({
  plugins: [react(), pinRootForBuild()],
  resolve: {
    alias: {
      '@app': path.resolve(__dirname, 'src/app'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@engine': path.resolve(__dirname, 'src/engine'),
      '@store': path.resolve(__dirname, 'src/store'),
      '@workers': path.resolve(__dirname, 'src/workers'),
      '@hooks': path.resolve(__dirname, 'src/hooks'),
      '@lib': path.resolve(__dirname, 'src/lib'),
      '@types': path.resolve(__dirname, 'src/types'),
    },
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    // During heavy Whisper inference the browser may drop the HMR WebSocket
    // briefly. Hiding the overlay prevents the "Lost connection" panic prompt
    // which causes users to reload and kill the in-progress worker.
    hmr: { overlay: false },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // A cold dev start was a ~30s black screen. The bulk of it (~11s) was Vite's
    // dependency *scan*: it crawls the whole module graph — including the
    // transcribe worker's `@huggingface/transformers` import, which drags in
    // onnxruntime-web (~130 MB of JS) — just to discover what to pre-bundle.
    //
    // `noDiscovery` skips that scan entirely and pre-bundles ONLY the list
    // below. This requires `include` to name every npm dependency the app
    // actually imports (transitive deps get bundled with their parent). KEEP
    // THIS IN SYNC WITH package.json `dependencies`: a runtime dep that's
    // missing here loads as raw ESM (slow, and breaks outright if it's CJS).
    include: [
      'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime',
      'zustand', 'immer', 'dexie', 'nanoid', 'lucide-react', 'comlink',
      'mp4box', 'mp4-muxer', '@breezystack/lamejs',
    ],
    // Heavy WASM/ML deps that are only used on demand (in-browser export, Whisper
    // captions). Excluding them keeps them out of the scan/pre-bundle and lets
    // them load natively the first time their feature is used.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@huggingface/transformers'],
    noDiscovery: true,
    holdUntilCrawlEnd: false,
  },
})
