import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { cloudflare } from '@cloudflare/vite-plugin'

// Vercel builds plain static files (dist/) and serves /api through api/proxy.ts. Locally the
// Cloudflare plugin runs the frontend Worker, which proxies /api over the BACKEND service binding.
const onVercel = Boolean(process.env.VERCEL)

// https://vite.dev/config/
export default defineConfig({
  // Fixed inspector port: the backend dev server uses 9230, and a stray 9229 would push this one onto it.
  plugins: [react(), tailwindcss(), ...(onVercel ? [] : [cloudflare({ inspectorPort: 9231 })])],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    // ../shared lives outside this package.
    fs: { allow: ['..'] },
  },
})
