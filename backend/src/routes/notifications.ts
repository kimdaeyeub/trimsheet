import { Hono } from 'hono';
import type { NotificationsResponse } from '@shared/types';
import { getRepo } from '../sheets/index.ts';

export const notifications = new Hono<{ Bindings: Env }>();

notifications.get('/', async (c) => c.json<NotificationsResponse>(await getRepo(c.env).listNotifications()));

notifications.post('/:id/read', async (c) => {
	await getRepo(c.env).markNotificationRead(c.req.param('id'));
	return c.body(null, 204);
});
