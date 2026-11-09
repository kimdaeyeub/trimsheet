import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests for pure logic (pipeline/*, sheets/rows, ...).
// Kept separate from vite.config.ts so the Flue + Cloudflare dev plugins are not loaded.
// Route/binding tests in the Workers runtime are added in Phase 1.7 (@cloudflare/vitest-pool-workers).
export default defineConfig({
	resolve: {
		alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
	},
	test: {
		environment: 'node',
		include: ['test/**/*.test.ts'],
	},
});
