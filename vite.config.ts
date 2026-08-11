import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves this repository from /talk/. Capacitor and local
  // builds keep relative asset URLs so the same bundle still works via file://.
  base: process.env.VITE_DEPLOY_TARGET === 'github-pages' ? '/talk/' : './',
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: true,
    port: 5173,
    // Dev 也保持生产形态：/api 和 /media 同源，由 vite 代理到本机后端。
    // 后端起不来时页面会报网络错误——先跑 talk-server serve。
    proxy: {
      '/api': { target: 'http://127.0.0.1:3300', changeOrigin: true },
      '/media': { target: 'http://127.0.0.1:3300', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:3300', changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split large, rarely-changing vendor deps into their own cacheable chunks
        // so the main app chunk stays small and page-level code-splitting can shine.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('dexie')) return 'vendor-db'
          if (id.includes('react-router') || id.includes('react-dom') || /[\\/]node_modules[\\/]react[\\/]/.test(id) || id.includes('scheduler')) {
            return 'vendor-react'
          }
        },
      },
    },
  },
})
