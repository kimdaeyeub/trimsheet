import { beforeEach, describe, expect, it } from 'vitest';
import { pageLookup } from '../src/pipeline/evidence.ts';
import { reconcile } from '../src/pipeline/reconcile.ts';
import { api } from '../src/routes/index.ts';
import { getRepo, resetMemorySheets } from '../src/sheets/index.ts';
import { resetLayoutMemo } from '../src/sheets/repo.ts';
import { writeJobResult } from '../src/sheets/result.ts';
import { makeEnv } from './helpers/env.ts';
import { PAGES, sampleExtraction } from './helpers/extraction.ts';

const call = (env: Env, path: string, init?: RequestInit) => api.request(`http://test${path}`, init, env);
const patch = (env: Env, path: string, body: unknown) =>
	call(env, path, { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

async function seed(env: Env) {
	const b = sampleExtraction();
	b.trims[0].price = 41_000_000; // one disagreement → one review row
	await writeJobResult(getRepo(env), { jobId: 'job_1', brand: 'hyundai', vehicleName: '스타리아', modelYear: '2027' }, reconcile(sampleExtraction(), b, { pageCount: 4, pages: pageLookup(PAGES), scanned: false }));
	const { items, review } = await getRepo(env).getJobItems('job_1');
	return { items, review };
}

beforeEach(() => {
	resetMemorySheets();
	resetLayoutMemo();
});

describe('review actions', () => {
	it('approves an item and closes its review row', async () => {
		const { env } = makeEnv();
		const { review } = await seed(env);
		const res = await patch(env, `/jobs/job_1/items/${review[0].itemId}`, { action: 'approve' });
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ sheet: 'trim', status: '승인' });
		const after = await getRepo(env).getJobItems('job_1');
		expect(after.items.trim.find((t) => t.itemId === review[0].itemId)?.status).toBe('승인');
		expect(after.review[0].progress).toBe('완료');
	});

	it('edits allowed fields with validation and marks the item 수정됨', async () => {
		const { env } = makeEnv();
		const { review } = await seed(env);
		const ok = await patch(env, `/jobs/job_1/items/${review[0].itemId}`, { action: 'edit', data: { price: '41,000,000원' } });
		expect(await ok.json()).toMatchObject({ status: '수정됨', values: { price: '41000000' } });

		const badPrice = await patch(env, `/jobs/job_1/items/${review[0].itemId}`, { action: 'edit', data: { price: '모름' } });
		expect(badPrice.status).toBe(400);
		const notEditable = await patch(env, `/jobs/job_1/items/${review[0].itemId}`, { action: 'edit', data: { evidencePage: '9' } });
		expect(notEditable.status).toBe(400);
	});

	it('validates colour hex and paints the preview cell', async () => {
		const { env } = makeEnv();
		const { items } = await seed(env);
		const id = items.color[0].itemId;
		expect((await patch(env, `/jobs/job_1/items/${id}`, { action: 'edit', data: { hex: 'red' } })).status).toBe(400);
		const res = await patch(env, `/jobs/job_1/items/${id}`, { action: 'edit', data: { hex: '#EDEBE4' } });
		expect(await res.json()).toMatchObject({ values: { hex: '#EDEBE4', hexSource: '사용자 수정' } });
	});

	it('rejects items and refuses items of another job', async () => {
		const { env } = makeEnv();
		const { items } = await seed(env);
		const res = await patch(env, `/jobs/job_1/items/${items.rule[0].itemId}`, { action: 'reject' });
		expect(await res.json()).toMatchObject({ status: '제외' });
		expect((await patch(env, `/jobs/job_2/items/${items.rule[0].itemId}`, { action: 'approve' })).status).toBe(404);
		expect((await patch(env, '/jobs/job_1/items/itm_missing', { action: 'approve' })).status).toBe(404);
		expect((await patch(env, `/jobs/job_1/items/${items.rule[0].itemId}`, { action: 'delete' })).status).toBe(400);
	});

	it('closes the approximate-hex summary row on approve only', async () => {
		const { env } = makeEnv();
		const a = sampleExtraction();
		a.colors[0].hex = '#EDEBE4';
		await writeJobResult(getRepo(env), { jobId: 'job_h', brand: 'hyundai', vehicleName: '스타리아', modelYear: '2027' }, reconcile(a, null, { pageCount: 4, pages: pageLookup(PAGES), scanned: false }));
		expect((await patch(env, '/jobs/job_h/items/hexsum_job_h', { action: 'reject' })).status).toBe(400);
		expect((await patch(env, '/jobs/job_h/items/hexsum_job_h', { action: 'approve' })).status).toBe(200);
		expect((await getRepo(env).getJobItems('job_h')).review[0].progress).toBe('완료');
	});

	it('approves every auto-confirmed item at once', async () => {
		const { env } = makeEnv();
		await seed(env);
		const res = await call(env, '/jobs/job_1/approve-all-auto', { method: 'POST' });
		expect(await res.json()).toEqual({ approved: 5 }); // 6 items, 1 needs review
		const { items } = await getRepo(env).getJobItems('job_1');
		expect(items.trim.map((t) => t.status).sort()).toEqual(['승인', '확인 필요']);
	});
});
