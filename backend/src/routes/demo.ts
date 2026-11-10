// "새 차종 테스트" button: process one new Genesis model end to end, then poll its progress.
import { Hono } from 'hono';
import type { DemoRun, DemoStatus } from '@shared/types';
import { listGenesis } from '../crawl/adapters/genesis.ts';
import { downloadPdf } from '../crawl/fetch-pdf.ts';
import { demoStatus, startRandomVehicle } from '../demo/random-vehicle.ts';
import { getRepo } from '../sheets/index.ts';
import { startTrimSheetJob } from '../shared/dispatch.ts';

export const demo = new Hono<{ Bindings: Env }>();

demo.get('/', async (c) => c.json<DemoStatus>(await demoStatus(getRepo(c.env), c.env.FILES)));

demo.post('/', async (c) => {
	const run = await startRandomVehicle({
		repo: getRepo(c.env),
		bucket: c.env.FILES,
		list: () => listGenesis(),
		download: downloadPdf,
		startJob: startTrimSheetJob,
	});
	return c.json<DemoRun>(run, 202);
});
