import { beforeEach, describe, expect, it } from 'vitest';
import type { PdfRef } from '../src/crawl/types.ts';
import { demoStatus, pickCandidate, startRandomVehicle, type DemoDeps } from '../src/demo/random-vehicle.ts';
import { getRepo, resetMemorySheets } from '../src/sheets/index.ts';
import { resetLayoutMemo } from '../src/sheets/repo.ts';
import { makeEnv } from './helpers/env.ts';
import { makePdf } from './helpers/pdf.ts';

const ref = (name: string, slug = name.toLowerCase()): PdfRef => ({ brand: 'genesis', vehicleName: name, url: `https://example.com/${slug}.pdf`, method: 'GET', siteKey: slug });

beforeEach(() => {
	resetMemorySheets();
	resetLayoutMemo();
});

async function setup(refs: PdfRef[]) {
	const { env, r2 } = makeEnv();
	const repo = getRepo(env);
	const started: { conversationId: string; sourceId: string; note: string }[] = [];
	const pdf = await makePdf(2);
	const deps: DemoDeps = {
		repo,
		bucket: env.FILES,
		list: async () => ({ refs, skipped: [] }),
		download: async (r) => ({ bytes: pdf, etag: '', lastModified: '', filename: r.url.split('/').pop() ?? 'x.pdf' }),
		startJob: async (i) => void started.push(i),
		random: () => 0,
		now: () => new Date('2026-11-10T13:00:00Z'),
	};
	return { env, r2, repo, deps, started };
}

describe('pickCandidate', () => {
	it('skips families already in the sheet', () => {
		const refs = [ref('G80'), ref('G80 전동화', 'g80-ev'), ref('GV70')];
		const taken = new Set(['g80']);
		expect(pickCandidate(refs, taken, () => 0)?.vehicleName).toBe('G80 전동화');
		expect(pickCandidate(refs, taken, () => 0.99)?.vehicleName).toBe('GV70');
		expect(pickCandidate([ref('G80')], taken)).toBeNull();
	});
});

describe('startRandomVehicle', () => {
	it('registers the PDF, records the run and starts the agent', async () => {
		const { repo, deps, started, env } = await setup([ref('G80'), ref('GV70')]);
		// G80 is already on screen (e.g. the golden draft).
		await repo.ensureLayout();
		await repo.port.append('트림', [['i1', 'golden_3', '제네시스', 'G80', '2026', '기본 모델', 1, '', '', 1, '', '확인 필요', '', '']]);

		const run = await startRandomVehicle(deps);
		expect(run).toMatchObject({ brand: '제네시스', vehicleName: 'GV70' });
		expect(started).toHaveLength(1);
		expect(started[0]).toMatchObject({ conversationId: run.conversationId, sourceId: run.sourceId });
		expect(await repo.findPdfSource(run.sourceId)).toMatchObject({ vehicleName: 'GV70', origin: 'crawl' });

		const s = await demoStatus(repo, env.FILES, new Date('2026-11-10T13:01:00Z'));
		expect(s).toMatchObject({ stage: 'starting', jobId: null, run: { vehicleName: 'GV70' } });
	});

	it('refuses a second run while one is in progress, allows it once done', async () => {
		const { repo, deps } = await setup([ref('GV70'), ref('GV80')]);
		const run = await startRandomVehicle(deps);
		await expect(startRandomVehicle(deps)).rejects.toMatchObject({ code: 'busy', status: 409 });

		await repo.createJobRow({ jobId: 'job_1', conversationId: run.conversationId, stage: 'finalized', vehicleName: 'GV70' });
		const second = await startRandomVehicle(deps);
		expect(second.conversationId).not.toBe(run.conversationId);
	});

	it('times out a stuck run after 20 minutes', async () => {
		const { repo, deps, env } = await setup([ref('GV70'), ref('GV80')]);
		const run = await startRandomVehicle(deps);
		await repo.createJobRow({ jobId: 'job_1', conversationId: run.conversationId, stage: 'pass_a_done', vehicleName: 'GV70' });
		expect((await demoStatus(repo, env.FILES, new Date('2026-11-10T13:10:00Z'))).stage).toBe('pass_a_done');
		expect((await demoStatus(repo, env.FILES, new Date('2026-11-10T13:30:00Z'))).stage).toBe('timeout');
	});

	it('explains when every model is already in the sheet', async () => {
		const { deps, repo } = await setup([ref('G80')]);
		await repo.upsertVehicle({ vehicleKey: 'genesis|g80|2026', familyKey: 'genesis|g80', vehicleName: 'G80', status: '처리 완료' });
		await expect(startRandomVehicle(deps)).rejects.toMatchObject({ code: 'no_candidate' });
	});
});
