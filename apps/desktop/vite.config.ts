import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      path: 'path-browserify',
    }
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        rewrite: (p) => p.replace(/^\/api/, '')
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true
      }
    }
  },
  envPrefix: ['VITE_', 'TAURI_'],
})
