// "Try a new vehicle" for users: pick one current model that is not in the sheet yet, download
// its price sheet and hand it to the TrimSheet agent — the same path a weekly scan takes, for one
// vehicle on demand. Genesis only: its line-up is plain HTML, so no Browser Run is billed.
import type { DemoRun, DemoStatus } from '@shared/types';
import type { downloadPdf } from '../crawl/fetch-pdf.ts';
import type { ListResult, PdfRef } from '../crawl/types.ts';
import { familyName } from '../pipeline/identity.ts';
import { pdfPageCount } from '../pipeline/pdf-info.ts';
import { BRAND_LABEL } from '../sheets/layout.ts';
import type { SheetsRepo } from '../sheets/repo.ts';
import { AppError } from '../shared/errors.ts';
import { sha256Hex, sourceIdFromSha } from '../shared/ids.ts';
import { kstNow } from '../shared/time.ts';
import { keys, putPdf, readState } from '../store/r2.ts';

export const SETTING_KEY = 'demo.current';
/** A run older than this no longer blocks a new one (the agent normally finishes in minutes). */
export const RUN_TIMEOUT_MS = 20 * 60_000;
const DONE_STAGES = new Set(['finalized', 'skipped', 'failed']);

export interface DemoDeps {
	repo: SheetsRepo;
	bucket: R2Bucket;
	list: () => Promise<ListResult>;
	download: typeof downloadPdf;
	startJob: (input: { conversationId: string; sourceId: string; filename: string; note: string }) => Promise<void>;
	random?: () => number;
	now?: () => Date;
}

/** Families already in the sheet (any data row) or registered as processed / in progress. */
export async function takenFamilies(repo: SheetsRepo): Promise<Set<string>> {
	const taken = new Set<string>();
	const rows = await repo.readCatalogRows();
	for (const list of Object.values(rows.items)) for (const r of list) if (r.status !== '제외' && r.vehicleName) taken.add(familyName(r.vehicleName) ?? r.vehicleName);
	for (const v of await repo.listVehicles()) if (v.status === '처리 완료' || v.status === '처리 중') taken.add(familyName(v.vehicleName) ?? v.vehicleName);
	return taken;
}

export function pickCandidate(refs: readonly PdfRef[], taken: ReadonlySet<string>, random: () => number = Math.random): PdfRef | null {
	const fresh = refs.filter((r) => !taken.has(familyName(r.vehicleName) ?? r.vehicleName));
	return fresh.length ? fresh[Math.floor(random() * fresh.length) % fresh.length] : null;
}

async function loadRun(repo: SheetsRepo): Promise<DemoRun | null> {
	const raw = await repo.getSetting(SETTING_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as DemoRun;
	} catch {
		return null;
	}
}

/** The latest run and how far it got (job row in 작업 + progress note in R2). */
export async function demoStatus(repo: SheetsRepo, bucket: R2Bucket, now: Date = new Date()): Promise<DemoStatus> {
	const run = await loadRun(repo);
	if (!run) return { run: null, stage: 'idle', jobId: null, progress: '', error: '' };
	const job = (await repo.listJobs(run.conversationId))[0] ?? null;
	const state = job ? (await readState(bucket, job.jobId))?.value ?? null : null;
	const stage = job?.stage || 'starting';
	const stale = !DONE_STAGES.has(stage) && now.getTime() - new Date(run.startedAtIso).getTime() > RUN_TIMEOUT_MS;
	return {
		run,
		stage: stale ? 'timeout' : stage,
		jobId: job?.jobId ?? null,
		progress: state?.progressNote ?? (job ? '' : '에이전트가 작업을 시작하는 중'),
		error: job?.error && stage !== 'finalized' ? job.error : '',
	};
}

export async function startRandomVehicle(deps: DemoDeps): Promise<DemoRun> {
	const now = deps.now?.() ?? new Date();
	const current = await demoStatus(deps.repo, deps.bucket, now);
	if (current.run && !['idle', 'timeout', 'finalized', 'skipped', 'failed'].includes(current.stage)) {
		throw new AppError('busy', `${current.run.vehicleName} 정리가 아직 진행 중입니다. 끝난 뒤 다시 시도하세요.`, 409);
	}

	const listing = await deps.list();
	if (listing.failure && listing.refs.length === 0) throw new AppError('list_failed', `제조사 사이트에서 차종 목록을 가져오지 못했습니다: ${listing.failure}`, 502);
	const ref = pickCandidate(listing.refs, await takenFamilies(deps.repo), deps.random);
	if (!ref) throw new AppError('no_candidate', '시트에 아직 없는 새 차종이 없습니다. 모든 차종이 이미 정리되어 있습니다.', 409);

	const dl = await deps.download(ref);
	const sha256 = await sha256Hex(dl.bytes);
	const sourceId = sourceIdFromSha(sha256);
	await putPdf(deps.bucket, sha256, dl.bytes, { filename: dl.filename, origin: 'crawl', sourceUrl: ref.url });
	await deps.repo.addPdfSourceIfNew({
		sourceId,
		origin: 'crawl',
		sourceUrl: ref.url,
		filename: dl.filename,
		pdfKey: keys.pdf(sha256),
		sha256,
		sizeBytes: dl.bytes.byteLength,
		pageCount: await pdfPageCount(dl.bytes),
		brand: BRAND_LABEL[ref.brand],
		vehicleName: ref.vehicleName,
		etag: dl.etag,
		lastModified: dl.lastModified,
		kind: 'pricesheet',
	});

	const conv = await deps.repo.createConversation(`${ref.vehicleName} (테스트)`);
	const run: DemoRun = {
		conversationId: conv.id,
		brand: BRAND_LABEL[ref.brand],
		vehicleName: ref.vehicleName,
		sourceId,
		startedAt: kstNow(now),
		startedAtIso: now.toISOString(),
	};
	await deps.repo.setSetting(SETTING_KEY, JSON.stringify(run));
	await deps.startJob({
		conversationId: conv.id,
		sourceId,
		filename: dl.filename,
		note: '사용자가 화면의 "새 차종 테스트" 버튼으로 이 가격표의 정리를 요청했습니다. 처음부터 끝까지 정리해 주세요.',
	});
	return run;
}
