import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requireApiKey } from '../src/shared/api-key.ts';

const app = new Hono<{ Bindings: Env }>();
app.use('/api/*', requireApiKey);
app.get('/api/ping', (c) => c.text('ok'));

const call = (key: string | null, envKey: string) =>
	app.request('http://t/api/ping', { headers: key === null ? {} : { 'x-trimsheet-key': key } }, { API_KEY: envKey } as Env);

describe('requireApiKey', () => {
	it('lets everything through when API_KEY is not set (local dev)', async () => {
		expect((await call(null, '')).status).toBe(200);
	});

	it('requires the exact key when API_KEY is set (deployed)', async () => {
		expect((await call(null, 'secret-123')).status).toBe(401);
		expect((await call('wrong', 'secret-123')).status).toBe(401);
		expect((await call('secret-1234', 'secret-123')).status).toBe(401);
		expect((await call('secret-123', 'secret-123')).status).toBe(200);
	});
});
