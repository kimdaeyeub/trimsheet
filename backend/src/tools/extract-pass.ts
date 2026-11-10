import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import type { JobState } from '@shared/types';
import { ExtractionUnavailableError, runPass, type PromptFn } from '../pipeline/extract.ts';
import { identify } from '../pipeline/identity.ts';
import { needsSubset, subsetPdf, toBase64, withNeighbours } from '../pipeline/pdf-subset.ts';
import type { Extraction } from '../pipeline/schema.ts';
import { MODELS, PIPELINE, SCAN_POLICY } from '../shared/config.ts';
import { AppError } from '../shared/errors.ts';
import { log as jlog } from '../shared/log.ts';
import { acquireVehicleLock, getJson, getPdfBytes, keys, putJson, releaseVehicleLock } from '../store/r2.ts';
import { deps, jobUrl, loadState, next, requireStage, updateState } from './common.ts';
import { checkVehicle, outcomeFor } from './dedup-check.ts';

type Pages = { page: number; text: string }[];

export const extractPass = defineTool({
	name: 'extract_pass',
	description:
		'작업(jobId)의 가격표에서 트림·색상·선택 품목·옵션 규칙을 추출합니다(pass "A" 또는 "B"). 수 분 걸릴 수 있습니다. skipped가 true면 멈추고 사유를 알리세요. 아니면 nextStep을 호출하세요.',
	input: v.object({ jobId: v.pipe(v.string(), v.startsWith('job_')), pass: v.picklist(['A', 'B']) }),
	harness: true,
	durable: true,
	timeoutMs: 900_000,
	async run({ data, harness, step, log }) {
		const { bucket, repo, openaiAvailable } = deps();
		const { jobId, pass } = data;
		const state = await loadState(bucket, jobId);
		if (pass === 'B' && !PIPELINE.twoPass) throw new AppError('not_enabled', '2차 추출은 아직 켜져 있지 않습니다. finalize_job을 호출하세요.');
		requireStage(state, pass === 'A' ? ['prepared'] : ['pass_a_done'], 'extract_pass');

		const [rawPages, layoutPages] = await Promise.all([
			getJson<Pages>(bucket, keys.jobFile(jobId, 'pages.json')),
			getJson<Pages>(bucket, keys.jobFile(jobId, 'layout.json')),
		]);
		if (!rawPages || !layoutPages || !state.pageMap) throw new AppError('missing_text', '페이지 텍스트가 없습니다. prepare_source부터 다시 실행하세요.');

		await step.do(`note:${pass}`, () => updateState(bucket, jobId, (s) => ({ ...s, progressNote: `${pass === 'A' ? '1' : '2'}차 추출 중…` })));

		// Each model call is one durable step; its (possibly large) result goes to R2, the step keeps only cost.
		const prompt: PromptFn = async (text, schema, opts) => {
			const key = keys.jobFile(jobId, `calls/${opts.label.replaceAll(':', '-')}.json`);
			const meta = await step.do(`prompt:${opts.label}`, async () => {
				log.info(`모델 호출: ${opts.label} (${opts.model})`);
				const res = await harness.prompt(text, { result: schema, model: opts.model, documents: opts.documents });
				await putJson(bucket, key, res.data);
				return { cost: res.usage.cost.total, tokens: res.usage.totalTokens };
			});
			jlog('info', 'extract_call', { jobId, label: opts.label, model: opts.model, ...meta });
			const out = await getJson<v.InferOutput<typeof schema>>(bucket, key);
			if (out === null) throw new AppError('missing_call_result', `모델 결과(${opts.label})를 찾을 수 없습니다.`);
			return out;
		};

		const getDocument = async () => {
			const bytes = await getPdfBytes(bucket, state.sha256);
			if (!bytes) throw new AppError('not_found', 'PDF 파일이 저장소에 없습니다.');
			const pageCount = state.pageCount ?? 0;
			if (!needsSubset(bytes.byteLength, pageCount)) return { base64: toBase64(new Uint8Array(bytes)), originalPages: null };
			const map = state.pageMap!;
			const wanted = withNeighbours([...map.cover, ...map.price, ...map.color, ...map.option, ...map.footnote], pageCount);
			const sub = await subsetPdf(bytes, wanted);
			return { base64: toBase64(sub.bytes), originalPages: sub.originalPages };
		};

		const fail = async (message: string) => {
			await step.do(`fail:${pass}`, async () => {
				await updateState(bucket, jobId, (s) => ({ ...s, stage: 'failed', outcome: 'error', error: message, progressNote: '추출 실패' }));
				if (state.lockedVehicleKey) await releaseVehicleLock(bucket, state.lockedVehicleKey, jobId);
				await repo.updateJobRow(jobId, { stage: 'failed', outcome: 'error', error: message });
				return true;
			});
			return { output: { skipped: true, failed: true, reason: message, nextStep: null } };
		};

		let result;
		try {
			result = await runPass(prompt, {
				pass,
				pageMap: state.pageMap,
				pageCount: state.pageCount ?? rawPages.length,
				layoutPages,
				rawPages,
				isScanned: Boolean(state.isScanned),
				looksLikePriceSheet: Boolean(state.pageMap.price.length),
				openaiAvailable,
				getDocument,
			});
		} catch (err) {
			if (err instanceof ExtractionUnavailableError) return fail(err.reason);
			return fail(`추출 중 오류: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
		}
		const ex: Extraction = result.extraction;
		await step.do(`save-pass:${pass}`, () => putJson(bucket, keys.jobFile(jobId, `pass-${pass.toLowerCase()}.json`), ex));

		const counts = { trims: ex.trims.length, colors: ex.colors.length, options: ex.options.length, rules: ex.rules.length };
		const stage: JobState['stage'] = pass === 'A' ? 'pass_a_done' : 'pass_b_done';
		const modelKey = pass === 'A' ? 'passA' : 'passB';

		// After pass A the model has read the cover: re-check duplicates / older year with its vehicle info.
		let vehicle = state.vehicle;
		if (pass === 'A' && ex.document.isPriceSheet) {
			const id = identify({
				brand: ex.document.brand ?? vehicle?.brand ?? null,
				name: ex.document.vehicleName ?? vehicle?.name ?? null,
				// Only an explicitly stated year is carried over; an inferred one is re-derived below.
				modelYear: ex.document.modelYear ?? (vehicle?.modelYearSource === 'stated' ? vehicle.modelYear : null),
				effectiveDate: ex.document.effectiveDate ?? vehicle?.effectiveDate ?? null,
				firstSeen: state.createdAt,
			});
			vehicle = { ...id };
			const d = await checkVehicle(repo, id, { sha256: state.sha256, force: state.force, ownJobId: jobId });
			if (d.action !== 'process') {
				await step.do('skip-after-a', async () => {
					await updateState(bucket, jobId, (s) => ({
						...s,
						stage: 'skipped',
						outcome: outcomeFor(d),
						dedup: { action: d.action, reason: d.reason, existingJobId: d.existingJobId },
						vehicle,
						models: { ...s.models, passA: result.model },
						progressNote: `건너뜀: ${d.reason}`,
					}));
					if (state.lockedVehicleKey) await releaseVehicleLock(bucket, state.lockedVehicleKey, jobId);
					await repo.updateJobRow(jobId, { stage: 'skipped', outcome: outcomeFor(d), vehicleName: id.name ?? '', modelYear: id.modelYear ?? '', error: d.reason });
					await repo.updatePdfSource(state.sourceId, { verdict: `${d.rule} ${d.reason}` });
					return true;
				});
				return {
					output: {
						skipped: true,
						reason: d.reason,
						rule: d.rule,
						vehicle: { name: id.name, modelYear: id.modelYear, effectiveDate: id.effectiveDate },
						existingJobId: d.existingJobId ?? null,
						existingJobUrl: d.existingJobId ? jobUrl(d.existingJobId) : null,
						nextStep: null,
					},
				};
			}
			// Lock the identity the model found (it may differ from the file-name guess).
			if (id.vehicleKey && id.vehicleKey !== state.lockedVehicleKey) {
				const lock = await step.do('relock', async () => {
					if (state.lockedVehicleKey) await releaseVehicleLock(bucket, state.lockedVehicleKey, jobId);
					return acquireVehicleLock(bucket, id.vehicleKey!, jobId, SCAN_POLICY.lockTtlMinutes);
				});
				if (!lock.acquired) return fail(`같은 차량을 다른 작업이 처리 중 (${lock.heldBy})`);
			}
		}

		const notPriceSheet = pass === 'A' && !ex.document.isPriceSheet;
		await step.do(`done:${pass}`, () =>
			updateState(bucket, jobId, (s) => ({
				...s,
				stage,
				outcome: notPriceSheet ? 'not_pricesheet' : s.outcome,
				vehicle,
				lockedVehicleKey: vehicle?.vehicleKey && pass === 'A' && !notPriceSheet ? vehicle.vehicleKey : s.lockedVehicleKey,
				models: { ...s.models, [modelKey]: result.model },
				fallbackReasons: [...s.fallbackReasons, ...result.fallbackReasons],
				progressNote: `${pass === 'A' ? '1' : '2'}차 추출 완료`,
			})),
		);

		const twoPass = PIPELINE.twoPass && !notPriceSheet;
		return {
			output: {
				skipped: false,
				jobId,
				pass,
				model: result.model,
				usedFallback: result.fallback,
				fallbackReasons: result.fallbackReasons,
				isPriceSheet: ex.document.isPriceSheet,
				vehicle: vehicle ? { name: vehicle.name, modelYear: vehicle.modelYear, effectiveDate: vehicle.effectiveDate } : null,
				counts,
				nextStep: pass === 'A' && twoPass ? next('extract_pass', { jobId, pass: 'B' }) : next('finalize_job', { jobId }),
			},
		};
	},
});

export const isFallbackModel = (model: string | undefined) => model === MODELS.fallback;
