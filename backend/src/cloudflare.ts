// Worker-level Cloudflare handlers; HTTP routing stays in src/app.ts.
// https://flueframework.com/docs/guide/cloudflare-target/#extending-cloudflarets-entrypoint
import { beginScan } from './scan/begin.ts';

export default {
	/** Weekly scan (Monday 09:00 KST). The scan-run row is written here so it exists even if the agent fails. */
	async scheduled(_controller, env) {
		await beginScan(env, 'cron');
	},
} satisfies ExportedHandler<Env>;
