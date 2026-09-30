import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss(), {
      name: 'distribution-licenses',
      generateBundle() {
        // Vite's dependency notices cover JavaScript modules, not font assets.
        this.emitFile({
          type: 'asset',
          fileName: 'GEIST_LICENSE.txt',
          source: readFileSync(require.resolve('@fontsource-variable/geist/LICENSE'), 'utf8'),
        })
        this.emitFile({
          type: 'asset',
          fileName: 'LICENSE',
          source: readFileSync(new URL('../../LICENSE', import.meta.url), 'utf8'),
        })
      },
    }],
    build: {
      license: { fileName: 'THIRD_PARTY_NOTICES.md' },
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      proxy: {
        '/api': env.VITE_API_PROXY_TARGET || 'http://localhost:8787',
      },
    },
  }
})
