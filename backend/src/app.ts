import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { TrimSheet } from './agents/trimsheet.ts';
import { Watcher } from './agents/watcher.ts';
import { api } from './routes/index.ts';
import { requireApiKey } from './shared/api-key.ts';
import { handleError } from './shared/errors.ts';

const app = new Hono<{ Bindings: Env }>();

// The route map: every agent and API route is mounted here explicitly.
// Deployed: the Vercel frontend's /api proxy function calls this Worker's workers.dev URL with the
// shared key (API_KEY). Local dev: the frontend Worker proxies over a service binding, no key.
//
//   curl -X POST http://localhost:5174/api/agents/trimsheet/my-first-chat \
//     -H 'content-type: application/json' \
//     -d '{"kind":"user","body":"안녕"}'

app.use('/api/*', requireApiKey);

// Agent routers first, so the REST API's not-found handler never shadows them.
app.route('/api/agents/trimsheet', createAgentRouter(TrimSheet));
app.route('/api/agents/watcher', createAgentRouter(Watcher));
app.route('/api', api);
app.onError(handleError);

export default app;
