import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The API mounts every route under /api (matching the Vercel rewrite), so the proxy must
// forward the prefix rather than strip it — rewriting it away made `npm run dev` 404 on
// every request while production worked fine.
const proxy = {
  '/api': {
    target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000',
    changeOrigin: true,
  },
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
})
