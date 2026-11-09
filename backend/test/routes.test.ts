import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiError, Conversation, UploadResponse } from '@shared/types';
import { api } from '../src/routes/index.ts';
import { resetMemorySheets } from '../src/sheets/index.ts';
import { resetLayoutMemo } from '../src/sheets/repo.ts';
import { makeEnv } from './helpers/env.ts';
import { makePdf } from './helpers/pdf.ts';

const call = (env: Env, path: string, init?: RequestInit) => api.request(`http://test${path}`, init, env);

beforeEach(() => {
	resetMemorySheets();
	resetLayoutMemo();
});

async function upload(env: Env, bytes: ArrayBuffer, name = '스타리아 가격표.pdf') {
	const form = new FormData();
	form.set('file', new File([bytes], name, { type: 'application/pdf' }));
	return call(env, '/uploads', { method: 'POST', body: form });
}

describe('REST API', () => {
	it('reports health without Google Sheets configured', async () => {
		const { env } = makeEnv();
		const res = await call(env, '/health');
		expect(await res.json()).toEqual({ ok: true, sheets: 'not_configured', openai: false });
	});

	it('creates, renames, lists and deletes conversations', async () => {
		const { env } = makeEnv();
		const created = (await (await call(env, '/conversations', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).json()) as Conversation;
		expect(created.title).toBe('새 작업');

		const renamed = await call(env, `/conversations/${created.id}`, {
			method: 'PATCH',
			body: JSON.stringify({ title: '  G80 가격표  ' }),
			headers: { 'content-type': 'application/json' },
		});
		expect(((await renamed.json()) as Conversation).title).toBe('G80 가격표');

		const bad = await call(env, `/conversations/${created.id}`, { method: 'PATCH', body: JSON.stringify({ title: '' }), headers: { 'content-type': 'application/json' } });
		expect(bad.status).toBe(400);
		expect(((await bad.json()) as ApiError).error.code).toBe('invalid_input');

		expect((await call(env, `/conversations/${created.id}`, { method: 'DELETE' })).status).toBe(204);
		expect(await (await call(env, '/conversations')).json()).toEqual([]);
	});

	it('uploads a PDF, dedupes by content, and serves it back', async () => {
		const { env, r2 } = makeEnv();
		const pdf = await makePdf(3);

		const first = await upload(env, pdf);
		expect(first.status).toBe(201);
		const body = (await first.json()) as UploadResponse;
		expect(body).toMatchObject({ filename: '스타리아 가격표.pdf', pageCount: 3, alreadyKnown: false });
		expect(body.sourceId).toMatch(/^src_[0-9a-f]{16}$/);

		const again = await upload(env, pdf, 'renamed.pdf');
		expect(again.status).toBe(200);
		expect(await again.json()).toMatchObject({ sourceId: body.sourceId, alreadyKnown: true });

		const key = [...r2.objects.keys()][0];
		const file = await call(env, `/files/${key}`);
		expect(file.status).toBe(200);
		expect(file.headers.get('content-type')).toBe('application/pdf');
		expect(file.headers.get('content-disposition')).toContain(encodeURIComponent('스타리아 가격표.pdf'));
		expect(new Uint8Array(await file.arrayBuffer()).byteLength).toBe(pdf.byteLength);
	});

	it('rejects non-PDF and broken uploads', async () => {
		const { env } = makeEnv();
		const bytes = (text: string) => new TextEncoder().encode(text).slice().buffer as ArrayBuffer;
		const notPdf = await upload(env, bytes('hello'));
		expect(notPdf.status).toBe(415);
		const broken = await upload(env, bytes('%PDF-1.7 garbage'));
		expect(broken.status).toBe(422);
	});

	it('does not serve arbitrary R2 keys', async () => {
		const { env } = makeEnv();
		expect((await call(env, '/files/pdf/..%2Fjobs%2Fx.pdf')).status).toBe(404);
		expect((await call(env, '/files/jobs/x/state.json')).status).toBe(404);
	});

	it('returns 404 for unknown jobs and JSON for unknown routes', async () => {
		const { env } = makeEnv();
		expect((await call(env, '/jobs/job_missing')).status).toBe(404);
		expect((await call(env, '/jobs/job_missing/state')).status).toBe(404);
		const res = await call(env, '/nope');
		expect(res.status).toBe(404);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found');
	});

	it('lists and reads notifications', async () => {
		const { env } = makeEnv();
		expect(await (await call(env, '/notifications')).json()).toEqual({ items: [], unread: 0 });
		expect((await call(env, '/notifications/ntf_x/read', { method: 'POST' })).status).toBe(404);
	});
});
