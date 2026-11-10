import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import type { Brand } from '@shared/types';
import { defaultScanDeps, scanBrand, type ScanSummary } from '../scan/scan.ts';
import { BRAND_LABEL } from '../sheets/layout.ts';
import { newId } from '../shared/ids.ts';
import { startTrimSheetJob } from '../shared/dispatch.ts';
import { putJson } from '../store/r2.ts';
import { deps } from './common.ts';
import { durable } from '../shared/durable.ts';

const BRANDS: Brand[] = ['hyundai', 'kia', 'genesis'];

/** Small, model-friendly summary of a whole scan. */
export function summarizeScan(summaries: ScanSummary[]) {
	const all = summaries.flatMap((s) => s.items);
	const names = (action: string) => all.filter((i) => i.decision.action === action).map((i) => `${i.vehicleName} — ${i.decision.reason}`);
	return {
		counts: {
			listed: summaries.reduce((n, s) => n + s.listed, 0),
			process: names('process').length,
			baseline: names('baseline').length,
			hold: names('hold').length + names('update_candidate').length,
			skipped: summaries.reduce((n, s) => n + s.counts.skip, 0),
		},
		processing: names('process'),
		held: [...names('hold'), ...names('update_candidate')],
		capped: summaries.some((s) => s.capped),
		failures: summaries.flatMap((s) => s.failures),
	};
}

export const scanBrands = defineTool({
	name: 'scan_brands',
	description:
		'현대·기아·제네시스 홈페이지의 현재 판매 차종 가격표를 확인합니다. 바뀐 PDF만 받고, 이미 정리한 차량·이전 연식은 건너뛰며, 처리 대상은 TrimSheet 작업으로 넘깁니다. 한 번만 호출하세요.',
	input: v.object({ scanRunId: v.pipe(v.string(), v.startsWith('scan_')), mode: v.picklist(['baseline', 'normal']) }),
	durable: true,
	timeoutMs: 900_000,
	async run({ data, step, log }) {
		const { env, bucket, repo } = deps();
		const scanDeps = {
			...defaultScanDeps(env),
			repo,
			bucket,
			startJob: startTrimSheetJob,
			step: <T>(name: string, fn: () => Promise<T>) => durable(step)(name, fn),
		};

		const summaries: ScanSummary[] = [];
		for (const brand of BRANDS) {
			log.info(`${BRAND_LABEL[brand]} 확인 중`);
			try {
				const s = await scanBrand(scanDeps, brand, data.mode);
				summaries.push(s);
				await durable(step)(`save:${brand}`, () => putJson(bucket, `scans/${data.scanRunId}/${brand}.json`, s));
			} catch (err) {
				summaries.push({
					brand,
					mode: data.mode,
					listed: 0,
					unchanged: 0,
					items: [],
					skippedOnSite: [],
					failures: [`${BRAND_LABEL[brand]}: ${err instanceof Error ? err.message : String(err)}`],
					capped: false,
					counts: { process: 0, baseline: 0, skip: 0, hold: 0 },
				});
			}
		}

		const summary = summarizeScan(summaries);
		await durable(step)('finish', async () => {
			await repo.finishScanRun(data.scanRunId, {
				candidateCount: summary.counts.listed,
				processCount: summary.counts.process,
				skipCount: summary.counts.skipped,
				holdCount: summary.counts.hold,
				failures: summary.failures.join('\n'),
			});
			// The first (baseline) scan only completes when every brand was read.
			const brandFailed = summaries.some((s) => s.listed === 0 && s.failures.length > 0);
			if (data.mode === 'baseline' && !brandFailed) await repo.setSetting('baseline_done', 'TRUE');
			const c = summary.counts;
			const title =
				data.mode === 'baseline'
					? `첫 확인 완료 — 기준선 ${c.baseline}대 등록`
					: c.process
						? `새 가격표 ${c.process}건 처리 시작`
						: '새 가격표 없음';
			const body = [
				c.hold ? `보류 ${c.hold}건(수집 현황에서 확인)` : '',
				summary.capped ? `한 번에 너무 많아 자동 처리하지 않았습니다` : '',
				summary.failures.length ? `수집 실패 ${summary.failures.length}건` : '',
			]
				.filter(Boolean)
				.join(' · ');
			await repo.addNotification({ id: newId('ntf'), kind: summary.failures.length && !c.listed ? 'scan_failed' : 'scan_done', title, body, jobId: '', scanRunId: data.scanRunId });
			return true;
		});

		return { output: { scanRunId: data.scanRunId, mode: data.mode, ...summary } };
	},
});
