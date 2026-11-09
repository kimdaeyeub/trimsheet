import { cloudflare } from '@cloudflare/vite-plugin';
import { flue, flueWorkerConfig } from '@flue/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// Backend dev server on 5174; the frontend dev server (5173) proxies /api here.
	server: { port: 5174, strictPort: true },
	plugins: [flue(), cloudflare({ config: flueWorkerConfig(), inspectorPort: 9230 })],
});
