// One brand's scan (PLAN.md Phase 6.3): list current line-up → L1 probe → download → L2 →
// cover-text identity → §7.11 decision → scan cap → apply. No LLM calls; processing is handed
// to TrimSheet conversations.
import type { Brand } from '@shared/types';
import { listBrand } from '../crawl/adapters/index.ts';
import { downloadPdf, probe, unchanged } from '../crawl/fetch-pdf.ts';
import type { ListResult, PdfRef } from '../crawl/types.ts';
import { applyScanCap, decide, type Decision, type RegisteredVehicle } from '../pipeline/dedup.ts';
import { identify, type VehicleIdentity } from '../pipeline/identity.ts';
import { pdfPageCount } from '../pipeline/pdf-info.ts';
import { extractPages } from '../pipeline/pdf-text.ts';
import { BRAND_LABEL } from '../sheets/layout.ts';
import type { SheetsRepo } from '../sheets/repo.ts';
import { SCAN_POLICY } from '../shared/config.ts';
import { sha256Hex, sourceIdFromSha } from '../shared/ids.ts';
import { log } from '../shared/log.ts';
import { keys, putPdf } from '../store/r2.ts';

export type ScanMode = 'baseline' | 'normal';

export interface ScanDeps {
	repo: SheetsRepo;
	bucket: R2Bucket;
	list: (brand: Brand) => Promise<ListResult>;
	probe: typeof probe;
	download: typeof downloadPdf;
	startJob: (input: { conversationId: string; sourceId: string; filename: string; note: string }) => Promise<void>;
	/** Durable step wrapper (Flue `step.do` in production, pass-through in tests). */
	step: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
	/** Politeness delay between requests to the same site. */
	sleep: (ms: number) => Promise<void>;
	now?: Date;
}

export interface ScanItem {
	vehicleName: string;
	url: string;
	sourceId: string | null;
	sha256: string | null;
	identity: Pick<VehicleIdentity, 'familyKey' | 'vehicleKey' | 'modelYear' | 'effectiveDate'> | null;
	decision: Decision;
	conversationId?: string;
}

export interface ScanSummary {
	brand: Brand;
	mode: ScanMode;
	listed: number;
	unchanged: number;
	items: ScanItem[];
	skippedOnSite: ListResult['skipped'];
	failures: string[];
	capped: boolean;
	counts: { process: number; baseline: number; skip: number; hold: number };
}

export const defaultScanDeps = (env: { BROWSER: BrowserRun }) => ({
	list: (brand: Brand) => listBrand(brand, env),
	probe,
	download: downloadPdf,
	sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
});

const skipUnchanged: Decision = { action: 'skip', rule: 'R1', reason: '변경 없음 (같은 URL, 같은 파일)' };

async function evaluate(deps: ScanDeps, ref: PdfRef, registry: RegisteredVehicle[], mode: ScanMode): Promise<ScanItem | 'unchanged'> {
	const known = await deps.repo.findPdfSourceByUrl(ref.url);
	if (known) {
		const probed = await deps.step(`probe:${ref.url}`, () => deps.probe(ref.url));
		if (probed && !probed.exists) return { vehicleName: ref.vehicleName, url: ref.url, sourceId: null, sha256: null, identity: null, decision: { action: 'skip', rule: 'NAME', reason: '가격표 링크가 없어짐(404)' } };
		if (unchanged(known, probed)) return 'unchanged';
	}

	const saved = await deps.step(`download:${ref.url}`, async () => {
		const dl = await deps.download(ref);
		const sha256 = await sha256Hex(dl.bytes);
		const sourceId = sourceIdFromSha(sha256);
		await putPdf(deps.bucket, sha256, dl.bytes, { filename: dl.filename, origin: 'crawl', sourceUrl: ref.url });
		const cover = await extractPages(dl.bytes, 2);
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
		return { sha256, sourceId, filename: dl.filename, coverText: cover.map((p) => p.text).join('\n').slice(0, 4000) };
	});

	const id = identify({
		brand: ref.brand,
		name: ref.vehicleName,
		filename: saved.filename,
		coverText: saved.coverText,
		firstSeen: (deps.now ?? new Date()).toISOString(),
		now: deps.now,
	});
	const decision = decide(
		{ familyKey: id.familyKey, vehicleKey: id.vehicleKey, modelYear: id.modelYear, effectiveDate: id.effectiveDate, sha256: saved.sha256, baselineMode: mode === 'baseline' },
		registry,
		SCAN_POLICY,
		deps.now,
	);
	return {
		vehicleName: ref.vehicleName,
		url: ref.url,
		sourceId: saved.sourceId,
		sha256: saved.sha256,
		identity: { familyKey: id.familyKey, vehicleKey: id.vehicleKey, modelYear: id.modelYear, effectiveDate: id.effectiveDate },
		decision,
	};
}

export async function scanBrand(deps: ScanDeps, brand: Brand, mode: ScanMode): Promise<ScanSummary> {
	const listing = await deps.step(`list:${brand}`, () => deps.list(brand));
	const failures: string[] = listing.failure ? [`${BRAND_LABEL[brand]}: ${listing.failure}`] : [];
	const registry: RegisteredVehicle[] = await deps.repo.listVehicles();

	const evaluated: ScanItem[] = [];
	let unchangedCount = 0;
	for (const ref of listing.refs) {
		try {
			const r = await evaluate(deps, ref, registry, mode);
			if (r === 'unchanged') unchangedCount++;
			else evaluated.push(r);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			failures.push(`${ref.vehicleName}: ${message}`);
			log('warn', 'scan_ref_failed', { brand, url: ref.url, message });
		}
		await deps.sleep(1_000);
	}

	const { items, capped } = applyScanCap(evaluated, SCAN_POLICY.maxAutoProcessPerScan);
	const brandLabel = BRAND_LABEL[brand];
	for (const it of items) {
		const d = it.decision;
		const verdict = `${d.rule} ${d.reason}`;
		await deps.step(`apply:${it.url}`, async () => {
			if (it.sourceId) await deps.repo.updatePdfSource(it.sourceId, { verdict });
			const id = it.identity;
			const regKey = id?.vehicleKey ?? (id?.familyKey ? `${id.familyKey}|연식미상` : null);
			const existing = regKey ? registry.find((r) => r.vehicleKey === regKey) : undefined;
			const base = { familyKey: id?.familyKey ?? '', brand: brandLabel, vehicleName: it.vehicleName, modelYear: id?.modelYear ?? '', effectiveDate: id?.effectiveDate ?? '', sourceId: it.sourceId ?? '', sourceUrl: it.url, reason: d.reason };
			if (d.action === 'baseline' && regKey) {
				await deps.repo.upsertVehicle({ vehicleKey: regKey, ...base, status: '기준선', sha256: it.sha256 ?? '' });
			} else if ((d.action === 'hold' || d.action === 'update_candidate') && regKey && existing?.status !== '처리 완료') {
				await deps.repo.upsertVehicle({ vehicleKey: regKey, ...base, status: d.action === 'hold' ? '보류' : '갱신 후보', sha256: it.sha256 ?? '' });
			} else if (d.action === 'process' && it.sourceId) {
				const conv = await deps.repo.createConversation(`${it.vehicleName} (자동 수집)`);
				it.conversationId = conv.id;
				await deps.startJob({ conversationId: conv.id, sourceId: it.sourceId, filename: it.vehicleName, note: `자동 수집: ${d.reason}. 이 가격표를 정리해 줘.` });
			}
			return true;
		});
	}

	const count = (a: string) => items.filter((i) => i.decision.action === a).length;
	return {
		brand,
		mode,
		listed: listing.refs.length,
		unchanged: unchangedCount,
		items,
		skippedOnSite: listing.skipped,
		failures,
		capped,
		counts: {
			process: count('process'),
			baseline: count('baseline'),
			skip: count('skip') + unchangedCount,
			hold: count('hold') + count('update_candidate'),
		},
	};
}
