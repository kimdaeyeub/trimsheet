// Binding access for code that runs outside a Hono handler (Flue tools, scheduled handlers).
// Hono routes should keep using `c.env`.
// TODO(Phase 2): confirm `cloudflare:workers` env is available inside Flue's Durable Objects;
// fall back to `getCloudflareContext().env` from '@flue/runtime/cloudflare' if not.
import { env } from 'cloudflare:workers';

export function getEnv(): Env {
	return env;
}
