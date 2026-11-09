// End-to-end tool flow with a fake model and fake bindings — no Cloudflare or AI calls.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as v from 'valibot';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeR2, asBucket } from './helpers/fake-r2.ts';

const fakeEnv: Record<string, unknown> = {};
vi.mock('cloudflare:workers', () => ({ env: fakeEnv }));

const { prepareSource } = await import('../src/tools/prepare-source.ts');
const { extractPass } = await import('../src/tools/extract-pass.ts');
const { finalizeJob } = await import('../src/tools/finalize-job.ts');
const { getRepo, resetMemorySheets } = await import('../src/sheets/index.ts');
const { resetLayoutMemo } = await import('../src/sheets/repo.ts');
const { sha256Hex, sourceIdFromSha } = await import('../src/shared/ids.ts');
const { keys, putPdf } = await import('../src/store/r2.ts');
const { MODELS } = await import('../src/shared/config.ts');

async function priceSheetPdf(year = '2027', date = '2026.11.01'): Promise<ArrayBuffer> {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const page = (lines: string[]) => {
		const p = doc.addPage([500, 400]);
		lines.forEach((l, i) => p.drawText(l, { x: 40, y: 360 - i * 22, size: 12, font }));
	};
	page([`Staria Electric ${year} MY price list`, `${date} gijun`]);
	page(['Trim | Price', 'Cargo 3 41,250,000', 'Cargo 5 42,100,000', 'Lounge 50,000,000', 'Tourer 45,300,000']);
	page(['Options', 'SmartSense 900,000', 'BuiltinCam 450,000', '* SmartSense and BuiltinCam cannot be combined']);
	page(['Exterior color', 'Creamy White WW2']);
	return (await doc.save()).slice().buffer;
}

function extraction(year: string, date: string) {
	const ev = (page: number, quote: string) => ({ page, quote });
	return {
		document: { isPriceSheet: true, brand: 'hyundai', vehicleName: 'Staria Electric', modelYear: year, effectiveDate: date, notes: [] },
		trims: [
			{ name: 'Cargo 3', price: 41_250_000, evidence: ev(2, 'Cargo 3 41,250,000'), confidence: 'high' },
			{ name: 'Cargo 5', price: 42_100_000, evidence: ev(2, 'Cargo 5 42,100,000'), confidence: 'high' },
		],
		colors: [{ kind: 'exterior', name: 'Creamy White', code: 'WW2', hex: null, applicableTrims: ['*'], evidence: ev(4, 'Creamy White WW2'), confidence: 'high' }],
		options: [
			{ name: 'SmartSense', price: 900_000, applicableTrims: ['*'], includes: [], evidence: ev(3, 'SmartSense 900,000'), confidence: 'high' },
			{ name: 'BuiltinCam', price: 450_000, applicableTrims: ['*'], includes: [], evidence: ev(3, 'BuiltinCam 450,000'), confidence: 'high' },
		],
		rules: [
			{
				type: 'exclusive',
				subject: 'SmartSense',
				targets: ['BuiltinCam'],
				condition: 'SmartSense',
				result: 'no BuiltinCam',
				footnoteText: '* SmartSense and BuiltinCam cannot be combined',
				evidence: { page: 3, quote: 'SmartSense and BuiltinCam cannot be combined', footnote: '*' },
				confidence: 'high',
			},
		],
	};
}

const step = { do: async <T>(_name: string, fn: () => T | Promise<T>) => fn() };
const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function harnessFor(year: string, date: string) {
	const calls: string[] = [];
	return {
		calls,
		harness: {
			prompt: (_text: string, opts: { result: v.GenericSchema; model: string }) => {
				calls.push(opts.model);
				return Promise.resolve({
					data: v.parse(opts.result, extraction(year, date)),
					usage: { cost: { total: 0 }, totalTokens: 0 },
					model: { provider: 'test', id: opts.model },
				});
			},
		},
	};
}

// The tools' run() takes the Flue context; tests pass the subset they use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (tool: { run: (ctx: any) => unknown }, ctx: Record<string, unknown>) =>
	tool.run({ toolCallId: 't', log, step, ...ctx }) as Promise<{ output: Record<string, any> }>;

async function upload(bytes: ArrayBuffer, filename = 'staria.pdf') {
	const sha = await sha256Hex(bytes);
	await putPdf(fakeEnv.FILES as R2Bucket, sha, bytes, { filename, origin: 'upload' });
	await getRepo(fakeEnv as never).addPdfSourceIfNew({ sourceId: sourceIdFromSha(sha), origin: 'upload', filename, pdfKey: keys.pdf(sha), sha256: sha, sizeBytes: bytes.byteLength, pageCount: 4 });
	return sourceIdFromSha(sha);
}

async function processAll(sourceId: string, year: string, date: string, force = false) {
	const prep = await run(prepareSource, { data: { sourceId, force } });
	if (prep.output.skipped) return { prep };
	const h = harnessFor(year, date);
	const a = await run(extractPass, { data: { jobId: prep.output.jobId, pass: 'A' }, harness: h.harness });
	if (a.output.skipped) return { prep, a, calls: h.calls };
	const fin = await run(finalizeJob, { data: { jobId: prep.output.jobId } });
	return { prep, a, fin, calls: h.calls };
}

beforeEach(() => {
	resetMemorySheets();
	resetLayoutMemo();
	Object.assign(fakeEnv, { FILES: asBucket(new FakeR2()), GOOGLE_SPREADSHEET_ID: '', GOOGLE_SERVICE_ACCOUNT_EMAIL: '', GOOGLE_PRIVATE_KEY: '', OPENAI_API_KEY: '' });
});

describe('tool flow (fake model)', () => {
	it('prepares, extracts with GLM and writes the result to the sheet', async () => {
		const src = await upload(await priceSheetPdf());
		const { prep, a, fin, calls } = await processAll(src, '2027', '2026-11-01');

		expect(prep.output).toMatchObject({ skipped: false, pageCount: 4, plannedModel: MODELS.extract, nextStep: { tool: 'extract_pass' } });
		expect(a!.output).toMatchObject({ skipped: false, model: MODELS.extract, usedFallback: false, nextStep: { tool: 'finalize_job' } });
		expect(calls).toEqual([MODELS.extract, MODELS.extract, MODELS.extract]); // three sections, no fallback
		expect(fin!.output).toMatchObject({ counts: { trims: 2, colors: 1, options: 2, rules: 1 }, sheetsConfigured: false });
		expect(fin!.output.reviewCount).toBe(0); // quotes match the PDF text, single pass

		const repo = getRepo(fakeEnv as never);
		const [vehicle] = await repo.listVehicles();
		expect(vehicle).toMatchObject({ vehicleKey: 'hyundai|staria electric|2027', status: '처리 완료', effectiveDate: '2026-11-01' });
		expect((await repo.getJob(prep.output.jobId))).toMatchObject({ stage: 'finalized', outcome: 'ok', trimCount: '2', modelA: MODELS.extract });
		expect((await repo.listNotifications()).unread).toBe(1);
	});

	it('skips the same file the second time without calling the model', async () => {
		const bytes = await priceSheetPdf();
		const src = await upload(bytes);
		await processAll(src, '2027', '2026-11-01');
		const again = await run(prepareSource, { data: { sourceId: src, force: true } });
		expect(again.output).toMatchObject({ skipped: true, rule: 'R1' });
	});

	it('skips an older model year after pass A (2026 when 2027 exists) and releases the lock', async () => {
		await processAll(await upload(await priceSheetPdf('2027', '2026.11.01')), '2027', '2026-11-01');
		const older = await processAll(await upload(await priceSheetPdf('2026', '2025.11.01'), 'old.pdf'), '2026', '2025-11-01');
		// The file name gives no vehicle name, so the decision happens after pass A.
		expect(older.a!.output).toMatchObject({ skipped: true, rule: 'R2' });
		const job = await getRepo(fakeEnv as never).getJob(older.prep.output.jobId);
		expect(job).toMatchObject({ stage: 'skipped', outcome: 'older_year' });
	});

	it('re-processes a newer price sheet of the same year and replaces the old rows', async () => {
		await processAll(await upload(await priceSheetPdf('2027', '2026.11.01')), '2027', '2026-11-01');
		const newer = await processAll(await upload(await priceSheetPdf('2027', '2026.12.01'), 'new.pdf'), '2027', '2026-12-01');
		expect(newer.fin!.output).toMatchObject({ replacedPrevious: true });
		const repo = getRepo(fakeEnv as never);
		const { items } = await repo.getJobItems(newer.prep.output.jobId);
		expect(items.trim).toHaveLength(2);
		expect((await repo.listVehicles())[0]).toMatchObject({ effectiveDate: '2026-12-01', lastJobId: newer.prep.output.jobId });
	});

	it('refuses scanned PDFs when no OpenAI key is configured', async () => {
		const doc = await PDFDocument.create();
		doc.addPage([400, 300]);
		doc.addPage([400, 300]);
		const src = await upload((await doc.save()).slice().buffer, 'scan.pdf');
		const prep = await run(prepareSource, { data: { sourceId: src } });
		expect(prep.output).toMatchObject({ skipped: true, rule: 'F1' });
		expect(prep.output.reason).toMatch(/OPENAI_API_KEY/);
	});

	it('rejects running steps out of order', async () => {
		const src = await upload(await priceSheetPdf());
		const prep = await run(prepareSource, { data: { sourceId: src } });
		await expect(run(finalizeJob, { data: { jobId: prep.output.jobId } })).rejects.toThrow(/prepared|pass_a_done/);
	});
});
