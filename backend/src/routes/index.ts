// REST API (everything under /api except the Flue agent routers, which app.ts mounts).
// Kept separate from app.ts so it can be tested without the Flue runtime.
import { Hono } from 'hono';
import { handleError } from '../shared/errors.ts';
import { catalog } from './catalog.ts';
import { conversations } from './conversations.ts';
import { files } from './files.ts';
import { jobs } from './jobs.ts';
import { notifications } from './notifications.ts';
import { scans } from './scans.ts';
import { system } from './system.ts';
import { uploads } from './uploads.ts';
import { vehicles } from './vehicles.ts';

export const api = new Hono<{ Bindings: Env }>();

api.route('/', system);
api.route('/conversations', conversations);
api.route('/uploads', uploads);
api.route('/files', files);
api.route('/jobs', jobs);
api.route('/notifications', notifications);
api.route('/vehicles', vehicles);
api.route('/scan-runs', scans);
api.route('/catalog', catalog);

api.onError(handleError);
api.notFound((c) => c.json({ error: { code: 'not_found', message: '없는 API 경로입니다.' } }, 404));
