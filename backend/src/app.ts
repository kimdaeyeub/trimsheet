import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { TrimSheet } from './agents/trimsheet.ts';
import { Watcher } from './agents/watcher.ts';
import { api } from './routes/index.ts';
import { handleError } from './shared/errors.ts';

const app = new Hono<{ Bindings: Env }>();

// The route map: every agent and API route is mounted here explicitly.
// The frontend Worker proxies `/api/*` to this Worker over a service binding.
//
//   curl -X POST http://localhost:5174/api/agents/trimsheet/my-first-chat \
//     -H 'content-type: application/json' \
//     -d '{"kind":"user","body":"안녕"}'

// Agent routers first, so the REST API's not-found handler never shadows them.
app.route('/api/agents/trimsheet', createAgentRouter(TrimSheet));
app.route('/api/agents/watcher', createAgentRouter(Watcher));
app.route('/api', api);
app.onError(handleError);

export default app;
