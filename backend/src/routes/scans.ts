import { Hono } from 'hono';
import { beginScan } from '../scan/begin.ts';
import { getRepo } from '../sheets/index.ts';

export const scans = new Hono<{ Bindings: Env }>();

scans.get('/', async (c) => {
	const repo = getRepo(c.env);
	const [runs, baselineDone] = await Promise.all([repo.listScanRuns(), repo.getSetting('baseline_done')]);
	return c.json({ runs, baselineDone: baselineDone === 'TRUE', schedule: '매주 월요일 09:00 (KST)' });
});

scans.post('/', async (c) => c.json(await beginScan(c.env, 'manual'), 202));
