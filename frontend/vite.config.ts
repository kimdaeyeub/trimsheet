import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { cloudflare } from '@cloudflare/vite-plugin'

// https://vite.dev/config/
export default defineConfig({
  // Fixed inspector port: the backend dev server uses 9230, and a stray 9229 would push this one onto it.
  plugins: [react(), tailwindcss(), cloudflare({ inspectorPort: 9231 })],
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
