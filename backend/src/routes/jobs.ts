import { Hono } from 'hono';
import type { JobDetailResponse } from '@shared/types';
import { getRepo, isSheetsConfigured } from '../sheets/index.ts';
import { AppError } from '../shared/errors.ts';
import { readState } from '../store/r2.ts';

export const jobs = new Hono<{ Bindings: Env }>();

const pdfUrlFromKey = (pdfKey: string | undefined) => (pdfKey?.startsWith('pdf/') ? `/api/files/${pdfKey}` : null);

jobs.get('/', async (c) => c.json(await getRepo(c.env).listJobs(c.req.query('conversationId') || undefined)));

// Cheap progress endpoint for tool-card polling: R2 only, no Sheets calls.
jobs.get('/:id/state', async (c) => {
	const state = await readState(c.env.FILES, c.req.param('id'));
	if (!state) throw new AppError('not_found', '작업을 찾을 수 없습니다.', 404);
	return c.json(state.value);
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
