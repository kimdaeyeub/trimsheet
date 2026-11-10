import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import type { JobState } from '@shared/types';
import { identify } from '../pipeline/identity.ts';
import { buildLayout } from '../pipeline/pdf-layout.ts';
import { extractPages } from '../pipeline/pdf-text.ts';
import { planModel } from '../pipeline/extract.ts';
import { analyzeStructure } from '../pipeline/structure.ts';
import { SCAN_POLICY } from '../shared/config.ts';
import { AppError } from '../shared/errors.ts';
import { newId } from '../shared/ids.ts';
import { isoNow } from '../shared/time.ts';
import { acquireVehicleLock, getPdfBytes, keys, putJson, writeState } from '../store/r2.ts';
import { deps, jobUrl, next } from './common.ts';
import { brandFromLabel, checkVehicle, processedSameFile } from './dedup-check.ts';
import { durable } from '../shared/durable.ts';

export const prepareSource = defineTool({
	name: 'prepare_source',
	description:
		'등록된 PDF(sourceId)를 분석해 작업을 만듭니다: 페이지 텍스트·표 복원, 가격표 구조 파악, 이미 정리한 차량인지·이전 연식인지 확인. skipped가 true면 처리를 멈추고 사유를 알리세요. 아니면 nextStep을 호출하세요. force는 사용자가 "다시 정리해 줘/그래도 처리해 줘"라고 명시했을 때만 true.',
	input: v.object({
		sourceId: v.pipe(v.string(), v.regex(/^src_[0-9a-f]{16}$/)),
		conversationId: v.optional(v.string()),
		force: v.optional(v.boolean()),
	}),
	durable: true,
	timeoutMs: 120_000,
	async run({ data, step, log }) {
		const { bucket, repo, openaiAvailable } = deps();
		const force = data.force ?? false;
		const src = await repo.findPdfSource(data.sourceId);
		if (!src) throw new AppError('not_found', `PDF ${data.sourceId}이(가) 등록되어 있지 않습니다. 먼저 업로드하거나 register_pdf_url을 호출하세요.`);

		const skipped = (reason: string, rule: string, existingJobId?: string) => ({
			output: { skipped: true, reason, rule, existingJobId: existingJobId ?? null, existingJobUrl: existingJobId ? jobUrl(existingJobId) : null, nextStep: null },
		});

		// R1 first: identical bytes already processed — never re-run, even when forced.
		const sameFile = await processedSameFile(repo, src.sha256);
		if (sameFile) return skipped(sameFile.reason, sameFile.rule, sameFile.existingJobId);

		const bytes = await getPdfBytes(bucket, src.sha256);
		if (!bytes) throw new AppError('not_found', 'PDF 파일이 저장소에 없습니다. 다시 업로드해 주세요.');
		log.info('PDF 텍스트 추출 중');
		const pages = await extractPages(bytes);
		const layout = buildLayout(pages);
		const rawPages = pages.map((p) => ({ page: p.page, text: p.text }));
		const structure = analyzeStructure(rawPages);

		// L3 (cheap): identity from file name / cover text, before any model call.
		const id = identify({
			name: src.vehicleName || null,
			brand: brandFromLabel(src.brand),
			modelYear: src.modelYear || null,
			filename: src.filename,
			// Genesis puts the date on p.2 (p.1 is a photo cover), so read the first two pages.
			coverText: rawPages.slice(0, 2).map((p) => p.text).join('\n'),
			firstSeen: src.fetchedAt || isoNow(),
		});
		if (id.vehicleKey) {
			const d = await checkVehicle(repo, id, { sha256: src.sha256, force });
			if (d.action !== 'process') {
				await durable(step)('verdict', () => repo.updatePdfSource(data.sourceId, { verdict: `${d.rule} ${d.reason}` }));
				return skipped(d.reason, d.rule, d.existingJobId);
			}
		}

		const plan = planModel({
			pass: 'A',
			pageMap: structure.pageMap,
			pageCount: pages.length,
			layoutPages: layout,
			rawPages,
			isScanned: structure.isScanned,
			looksLikePriceSheet: structure.looksLikePriceSheet,
			openaiAvailable,
			getDocument: async () => ({ base64: '', originalPages: null }),
		});

		if (plan.mode === 'unavailable') {
			return {
				output: { skipped: true, reason: `${plan.reason} — OpenAI 키(OPENAI_API_KEY)가 설정되지 않아 처리할 수 없습니다.`, rule: 'F1', existingJobId: null, existingJobUrl: null, nextStep: null },
			};
		}

		const jobId = await durable(step)('job-id', () => newId('job'));
		if (id.vehicleKey) {
			const lock = await durable(step)('lock', () => acquireVehicleLock(bucket, id.vehicleKey!, jobId, SCAN_POLICY.lockTtlMinutes));
			if (!lock.acquired) return skipped(`같은 차량을 다른 작업이 처리 중 (${lock.heldBy})`, 'R5');
		}

		await durable(step)('save-text', async () => {
			await putJson(bucket, keys.jobFile(jobId, 'pages.json'), rawPages);
			await putJson(bucket, keys.jobFile(jobId, 'layout.json'), layout);
			return true;
		});

		const now = isoNow();
		const state: JobState = {
			jobId,
			conversationId: data.conversationId ?? null,
			sourceId: data.sourceId,
			stage: 'prepared',
			outcome: structure.isScanned ? 'scanned' : null,
			progressNote: 'PDF 분석 완료 — 1차 추출 대기',
			pageCount: pages.length,
			pageMap: structure.pageMap,
			isScanned: structure.isScanned,
			vehicle: { ...id },
			dedup: null,
			force,
			sha256: src.sha256,
			filename: src.filename,
			sourceUrl: src.sourceUrl || null,
			lockedVehicleKey: id.vehicleKey,
			models: {},
			fallbackReasons: plan.mode === 'document' ? [plan.reason] : [],
			counts: null,
			error: null,
			createdAt: now,
			updatedAt: now,
		};
		await durable(step)('state', () => writeState(bucket, state));
		await durable(step)('job-row', () =>
			repo.createJobRow({
				jobId,
				conversationId: data.conversationId ?? '',
				filename: src.filename,
				sourceUrl: src.sourceUrl,
				pdfKey: src.pdfKey,
				stage: 'prepared',
				vehicleName: id.name ?? '',
				modelYear: id.modelYear ?? '',
			}),
		);

		return {
			output: {
				skipped: false,
				jobId,
				pageCount: pages.length,
				pageMap: { ...structure.pageMap },
				isScanned: structure.isScanned,
				looksLikePriceSheet: structure.looksLikePriceSheet,
				vehicle: { brand: id.brand, name: id.name, modelYear: id.modelYear, effectiveDate: id.effectiveDate },
				plannedModel: plan.model,
				nextStep: next('extract_pass', { jobId, pass: 'A' }),
			},
		};
	},
});
