import { describe, expect, it, vi } from 'vitest';
import * as v from 'valibot';
import { ExtractionUnavailableError, planModel, runPass, type PassInput, type PromptFn } from '../src/pipeline/extract.ts';
import { buildPrompt } from '../src/pipeline/prompts.ts';
import { MODELS } from '../src/shared/config.ts';
import { PAGES, sampleExtraction } from './helpers/extraction.ts';

const pageMap = { cover: [1], price: [2], color: [4], option: [3], footnote: [3], other: [] };

const input = (over: Partial<PassInput> = {}): PassInput => ({
	pass: 'A',
	pageMap,
	pageCount: 4,
	layoutPages: PAGES,
	rawPages: PAGES,
	isScanned: false,
	looksLikePriceSheet: true,
	openaiAvailable: true,
	getDocument: async () => ({ base64: 'JVBERi0=', originalPages: null }),
	...over,
});

/** Fake model: returns sections of `ex` (or throws) and records calls. */
function fakeModel(behaviour: (model: string, label: string) => 'ok' | 'fail' | 'bad' = () => 'ok') {
	const calls: { model: string; label: string; text: string; documents: boolean }[] = [];
	const prompt: PromptFn = async (text, schema, opts) => {
		calls.push({ model: opts.model, label: opts.label, text, documents: Boolean(opts.documents) });
		const mode = behaviour(opts.model, opts.label);
		if (mode === 'fail') throw new Error('ResultUnavailable');
		const ex = sampleExtraction();
		if (mode === 'bad') for (const t of [...ex.trims, ...ex.options, ...ex.colors, ...ex.rules]) t.evidence.quote = '지어낸 문장입니다 99999';
		const full = { document: ex.document, trims: ex.trims, colors: ex.colors, options: ex.options, rules: ex.rules };
		return v.parse(schema, full);
	};
	return { prompt, calls };
}

describe('planModel (F1, F2)', () => {
	it('uses GLM text mode normally, OpenAI for scanned PDFs, unavailable without a key', () => {
		expect(planModel(input())).toEqual({ mode: 'text', model: MODELS.extract });
		expect(planModel(input({ isScanned: true }))).toMatchObject({ mode: 'document', model: MODELS.fallback });
		expect(planModel(input({ isScanned: true, openaiAvailable: false }))).toMatchObject({ mode: 'unavailable' });
		const huge = [{ page: 2, text: 'x'.repeat(400_000) }];
		expect(planModel(input({ layoutPages: huge, rawPages: huge }))).toMatchObject({ mode: 'document' });
	});
});

describe('runPass', () => {
	it('runs three GLM section prompts with page-marked text', async () => {
		const { prompt, calls } = fakeModel();
		const out = await runPass(prompt, input());
		expect(out).toMatchObject({ model: MODELS.extract, fallback: false, fallbackReasons: [] });
		expect(calls.map((c) => c.label)).toEqual(['A:trimsColors:t1', 'A:options:t1', 'A:rules:t1']);
		expect(calls[0].text).toContain('=== p.2 ===');
		expect(calls[2].text).toContain('옵션 목록: "스마트센스", "빌트인 캠"');
		expect(out.extraction.rules).toHaveLength(1);
	});

	it('retries GLM once, then falls back to OpenAI with the PDF attached (F3)', async () => {
		const { prompt, calls } = fakeModel((model) => (model === MODELS.extract ? 'fail' : 'ok'));
		const out = await runPass(prompt, input());
		expect(out.fallback).toBe(true);
		expect(out.fallbackReasons[0]).toMatch(/GLM 추출 2회 실패/);
		expect(calls.filter((c) => c.model === MODELS.extract)).toHaveLength(2);
		expect(calls.filter((c) => c.model === MODELS.fallback).every((c) => c.documents)).toBe(true);
	});

	it('falls back when the GLM result fails the quality check (F4)', async () => {
		const { prompt } = fakeModel((model) => (model === MODELS.extract ? 'bad' : 'ok'));
		const out = await runPass(prompt, input());
		expect(out.fallback).toBe(true);
		expect(out.quality.ok).toBe(true);
	});

	it('keeps the GLM result (to be reviewed) when quality is poor and there is no OpenAI key', async () => {
		const { prompt } = fakeModel(() => 'bad');
		const out = await runPass(prompt, input({ openaiAvailable: false }));
		expect(out.fallback).toBe(false);
		expect(out.quality.ok).toBe(false);
		expect(out.fallbackReasons[0]).toMatch(/OpenAI 키가 없어/);
	});

	it('refuses scanned PDFs without an OpenAI key', async () => {
		const { prompt } = fakeModel();
		await expect(runPass(prompt, input({ isScanned: true, openaiAvailable: false }))).rejects.toBeInstanceOf(ExtractionUnavailableError);
	});

	it('maps subset page numbers back to the original PDF', async () => {
		const prompt = vi.fn(async (_t: string, schema: v.GenericSchema) => {
			const ex = sampleExtraction();
			for (const t of ex.trims) t.evidence.page = 1; // subset page 1 = original p.2
			return v.parse(schema, ex);
		}) as unknown as PromptFn;
		const out = await runPass(prompt, input({ isScanned: true, getDocument: async () => ({ base64: 'x', originalPages: [2, 3, 4] }) }));
		expect(out.extraction.trims.every((t) => t.evidence.page === 2)).toBe(true);
	});

	it('stops after the first section when the document is not a price sheet', async () => {
		const calls: string[] = [];
		const prompt: PromptFn = async (_t, schema, opts) => {
			calls.push(opts.label);
			const ex = sampleExtraction();
			return v.parse(schema, { ...ex, document: { ...ex.document, isPriceSheet: false }, trims: [], colors: [] });
		};
		const out = await runPass(prompt, input({ looksLikePriceSheet: false }));
		expect(calls).toEqual(['A:trimsColors:t1']);
		expect(out.extraction.document.isPriceSheet).toBe(false);
	});
});

describe('buildPrompt', () => {
	it('differs between passes and includes known names', () => {
		const a = buildPrompt({ pass: 'A', section: 'rules', pagesText: 'x', knownTrims: ['카고'], knownOptions: ['캠'] });
		const b = buildPrompt({ pass: 'B', section: 'rules', pagesText: 'x' });
		expect(a).toContain('" | "는 표의 열 경계');
		expect(b).toContain('먼저 문서의 모든 각주');
		expect(a).toContain('트림 목록: "카고"');
		expect(buildPrompt({ pass: 'A', section: 'options', documentNote: '1→p.3' })).toContain('첨부되어 있습니다.\n1→p.3');
	});
});
