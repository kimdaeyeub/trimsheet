import { Hono } from 'hono';
import * as v from 'valibot';
import type { ItemActionResponse, JobDetailResponse } from '@shared/types';
import { applyItemAction, approveAllAuto } from '../sheets/review.ts';
import { parseJson } from './validate.ts';
import { getRepo, isSheetsConfigured } from '../sheets/index.ts';
import { AppError } from '../shared/errors.ts';
import { getJson, keys, readState } from '../store/r2.ts';

export const jobs = new Hono<{ Bindings: Env }>();

const pdfUrlFromKey = (pdfKey: string | undefined) => (pdfKey?.startsWith('pdf/') ? `/api/files/${pdfKey}` : null);

jobs.get('/', async (c) => c.json(await getRepo(c.env).listJobs(c.req.query('conversationId') || undefined)));

// Cheap progress endpoint for tool-card polling: R2 only, no Sheets calls.
jobs.get('/:id/state', async (c) => {
	const state = await readState(c.env.FILES, c.req.param('id'));
	if (!state) throw new AppError('not_found', '작업을 찾을 수 없습니다.', 404);
	return c.json(state.value);
});

// Stored verification result (used by scripts/eval.ts).
jobs.get('/:id/report', async (c) => {
	const jobId = c.req.param('id');
	const [report, state] = await Promise.all([getJson(c.env.FILES, keys.jobFile(jobId, 'report.json')), readState(c.env.FILES, jobId)]);
	if (!report) throw new AppError('not_found', '이 작업의 검증 결과가 없습니다(아직 정리되지 않음).', 404);
	return c.json({ jobId, vehicle: [state?.value.vehicle?.name, state?.value.vehicle?.modelYear].filter(Boolean).join(' '), report });
});

jobs.get('/:id', async (c) => {
	const jobId = c.req.param('id');
	const repo = getRepo(c.env);
	const [state, job, { items, review }] = await Promise.all([
		readState(c.env.FILES, jobId),
		repo.getJob(jobId),
		repo.getJobItems(jobId),
	]);
	if (!state && !job) throw new AppError('not_found', '작업을 찾을 수 없습니다.', 404);
	return c.json<JobDetailResponse>({
		state: state?.value ?? null,
		job,
		items,
		review,
		pdfUrl: pdfUrlFromKey(job?.pdfKey),
		sheetUrl: isSheetsConfigured(c.env) ? repo.port.spreadsheetUrl() : null,
	});
});

const ItemAction = v.variant('action', [
	v.object({ action: v.literal('approve') }),
	v.object({ action: v.literal('reject') }),
	v.object({ action: v.literal('edit'), data: v.record(v.string(), v.pipe(v.string(), v.maxLength(2000))) }),
]);

jobs.patch('/:id/items/:itemId', async (c) => {
	const body = await parseJson(c, ItemAction);
	const res = await applyItemAction(getRepo(c.env), c.req.param('id'), c.req.param('itemId'), body);
	return c.json<ItemActionResponse>(res);
});

jobs.post('/:id/approve-all-auto', async (c) => {
	const approved = await approveAllAuto(getRepo(c.env), c.req.param('id'));
	return c.json({ approved });
});
