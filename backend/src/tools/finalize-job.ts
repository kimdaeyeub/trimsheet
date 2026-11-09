import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { pageLookup } from '../pipeline/evidence.ts';
import { reconcile } from '../pipeline/reconcile.ts';
import type { Extraction } from '../pipeline/schema.ts';
import { BRAND_LABEL } from '../sheets/layout.ts';
import { writeJobResult } from '../sheets/result.ts';
import { PIPELINE } from '../shared/config.ts';
import { AppError } from '../shared/errors.ts';
import { newId } from '../shared/ids.ts';
import { getJson, keys, putJson, releaseVehicleLock } from '../store/r2.ts';
import { deps, jobUrl, loadState, requireStage, updateState } from './common.ts';
import { isFallbackModel } from './extract-pass.ts';

type Pages = { page: number; text: string }[];

export const finalizeJob = defineTool({
	name: 'finalize_job',
	description: '추출 결과를 검증·비교해 "자동 확정"/"확인 필요"로 나누고 Google Sheets에 올립니다. 결과의 개수와 확인 필요 건수를 사용자에게 알리세요.',
	input: v.object({ jobId: v.pipe(v.string(), v.startsWith('job_')) }),
	durable: true,
	timeoutMs: 300_000,
	async run({ data, step, log }) {
		const { bucket, repo, sheetsConfigured } = deps();
		const { jobId } = data;
		const state = await loadState(bucket, jobId);
		// Two-pass jobs need pass B — except documents pass A already found not to be price sheets.
		const needsB = PIPELINE.twoPass && state.outcome !== 'not_pricesheet';
		requireStage(state, needsB ? ['pass_b_done'] : ['pass_a_done', 'pass_b_done'], 'finalize_job');
		const sheetUrl = sheetsConfigured ? repo.port.spreadsheetUrl() : null;

		const release = () => (state.lockedVehicleKey ? releaseVehicleLock(bucket, state.lockedVehicleKey, jobId) : Promise.resolve());

		if (state.outcome === 'not_pricesheet') {
			await step.do('not-pricesheet', async () => {
				await repo.updateJobRow(jobId, { stage: 'finalized', outcome: 'not_pricesheet' });
				await repo.updatePdfSource(state.sourceId, { kind: 'catalog', verdict: '가격표 아님' });
				await updateState(bucket, jobId, (s) => ({ ...s, stage: 'finalized', progressNote: '가격표가 아니어서 정리하지 않음' }));
				await release();
				return true;
			});
			return { output: { jobId, isPriceSheet: false, message: '가격표가 아닌 PDF라 정리하지 않았습니다.', nextStep: null } };
		}

		const a = await getJson<Extraction>(bucket, keys.jobFile(jobId, 'pass-a.json'));
		const b = state.stage === 'pass_b_done' ? await getJson<Extraction>(bucket, keys.jobFile(jobId, 'pass-b.json')) : null;
		const raw = await getJson<Pages>(bucket, keys.jobFile(jobId, 'pages.json'));
		if (!a || !raw) throw new AppError('missing_pass', '1차 추출 결과가 없습니다. extract_pass를 먼저 실행하세요.');

		log.info('검증·판정 중');
		const result = reconcile(a, b, {
			pageCount: state.pageCount ?? raw.length,
			pages: state.isScanned ? null : pageLookup(raw),
			scanned: Boolean(state.isScanned),
			fallbackA: isFallbackModel(state.models.passA),
			fallbackB: isFallbackModel(state.models.passB),
		});
		await step.do('report', () => putJson(bucket, keys.jobFile(jobId, 'report.json'), result));

		const vehicle = state.vehicle;
		const vehicleName = a.document.vehicleName ?? vehicle?.name ?? state.filename.replace(/\.pdf$/i, '');
		const modelYear = vehicle?.modelYear ?? a.document.modelYear ?? '';
		const brand = vehicle?.brand ?? a.document.brand ?? null;

		log.info('Google Sheets에 반영 중');
		const summary = await step.do('write-sheets', () => writeJobResult(repo, { jobId, brand, vehicleName, modelYear }, result));

		await step.do('registry', async () => {
			if (vehicle?.vehicleKey && vehicle.familyKey) {
				await repo.upsertVehicle({
					vehicleKey: vehicle.vehicleKey,
					familyKey: vehicle.familyKey,
					brand: brand ? BRAND_LABEL[brand] : '',
					vehicleName,
					modelYear,
					effectiveDate: vehicle.effectiveDate ?? '',
					status: '처리 완료',
					lastJobId: jobId,
					sourceId: state.sourceId,
					sha256: state.sha256,
					sourceUrl: state.sourceUrl ?? '',
					reason: state.force ? '사용자 요청으로 정리' : '정리 완료',
				});
				await repo.markOlderYears(vehicle.familyKey, modelYear);
			}
			const c = result.counts;
			await repo.updateJobRow(jobId, {
				stage: 'finalized',
				outcome: 'ok',
				brand: brand ? BRAND_LABEL[brand] : '',
				vehicleName,
				modelYear,
				effectiveDate: vehicle?.effectiveDate ?? a.document.effectiveDate ?? '',
				modelA: state.models.passA ?? '',
				modelB: state.models.passB ?? '',
				trimCount: String(c.trims),
				colorCount: String(c.colors),
				optionCount: String(c.options),
				ruleCount: String(c.rules),
				reviewCount: String(c.review),
				error: state.fallbackReasons.join('; '),
			});
			await repo.updatePdfSource(state.sourceId, {
				kind: 'pricesheet',
				verdict: '정리 완료',
				brand: brand ? BRAND_LABEL[brand] : '',
				vehicleName,
				modelYear,
			});
			const replaced = summary.replacedRows > 0 ? ' 기존 결과를 새 가격표 결과로 교체했습니다(검토 내용 포함).' : '';
			await repo.addNotification({
				id: newId('ntf'),
				kind: 'job_done',
				title: `${vehicleName} ${modelYear} 정리 완료`,
				body: `트림 ${c.trims} · 색상 ${c.colors} · 선택 품목 ${c.options} · 규칙 ${c.rules}, 확인 필요 ${c.review}건.${replaced}`,
				jobId,
				scanRunId: '',
			});
			await release();
			await updateState(bucket, jobId, (s) => ({ ...s, stage: 'finalized', outcome: 'ok', counts: c, progressNote: '정리 완료' }));
			return true;
		});

		return {
			output: {
				jobId,
				vehicle: { name: vehicleName, modelYear },
				counts: result.counts,
				reviewCount: result.counts.review,
				replacedPrevious: summary.replacedRows > 0,
				sheetUrl,
				sheetsConfigured,
				jobUrl: jobUrl(jobId),
				nextStep: null,
			},
		};
	},
});
