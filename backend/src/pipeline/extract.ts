// One extraction pass = three section prompts, with model choice and OpenAI fallback (PLAN.md §6.2).
// The model call is injected (`PromptFn`) so this logic is testable and the Flue tool can wrap
// each call in a durable step.
import type * as v from 'valibot';
import type { PageMap } from '@shared/types';
import { FALLBACK, MODELS } from '../shared/config.ts';
import { pageLookup } from './evidence.ts';
import { renderPages } from './pdf-layout.ts';
import { remapPage, subsetNote } from './pdf-subset.ts';
import { buildPrompt, type Pass, type Section } from './prompts.ts';
import { checkQuality, type QualityReport } from './quality.ts';
import { SectionOptions, SectionRules, SectionTrimsColors, type Extraction } from './schema.ts';
import { relevantPages } from './structure.ts';

export interface PromptDocumentInput {
	type: 'document';
	data: string;
	mimeType: 'application/pdf';
}

export type PromptFn = <S extends v.GenericSchema>(
	text: string,
	schema: S,
	opts: { model: string; documents?: PromptDocumentInput[]; label: string },
) => Promise<v.InferOutput<S>>;

export interface PassInput {
	pass: Pass;
	pageMap: PageMap;
	pageCount: number;
	/** Table-shaped text (Pass A). */
	layoutPages: { page: number; text: string }[];
	/** Raw text (Pass B, evidence checks). */
	rawPages: { page: number; text: string }[];
	isScanned: boolean;
	looksLikePriceSheet: boolean;
	openaiAvailable: boolean;
	/** Lazily load the (possibly subset) PDF for document mode. */
	getDocument: () => Promise<{ base64: string; originalPages: number[] | null }>;
}

export interface PassOutput {
	extraction: Extraction;
	model: string;
	fallback: boolean;
	fallbackReasons: string[];
	quality: QualityReport;
}

export class ExtractionUnavailableError extends Error {
	constructor(readonly reason: string) {
		super(reason);
		this.name = 'ExtractionUnavailableError';
	}
}

export type ModelPlan =
	| { mode: 'text'; model: string }
	| { mode: 'document'; model: string; reason: string }
	| { mode: 'unavailable'; reason: string };

const SECTIONS: Section[] = ['trimsColors', 'options', 'rules'];

const pagesFor = (input: PassInput, section: Section) => {
	const rel = relevantPages(input.pageMap, section);
	const source = input.pass === 'A' ? input.layoutPages : input.rawPages;
	return renderPages(source, rel.size > 0 ? rel : undefined);
};

/** F1 (scanned) and F2 (too much text) are decided before any model call. */
export function planModel(input: PassInput): ModelPlan {
	const toDocument = (reason: string): ModelPlan =>
		input.openaiAvailable ? { mode: 'document', model: MODELS.fallback, reason } : { mode: 'unavailable', reason };
	if (input.isScanned) return toDocument('스캔본(텍스트 레이어 없음)');
	const longest = Math.max(...SECTIONS.map((s) => pagesFor(input, s).length));
	if (longest > FALLBACK.maxLayoutChars) return toDocument(`텍스트가 너무 김(${longest.toLocaleString()}자)`);
	return { mode: 'text', model: MODELS.extract };
}

async function runSections(prompt: PromptFn, input: PassInput, plan: Exclude<ModelPlan, { mode: 'unavailable' }>, attempt: string): Promise<Extraction> {
	const doc = plan.mode === 'document' ? await input.getDocument() : null;
	const documents = doc ? [{ type: 'document' as const, data: doc.base64, mimeType: 'application/pdf' as const }] : undefined;
	const documentNote = doc?.originalPages ? subsetNote(doc.originalPages) : undefined;
	const textFor = (section: Section) => (plan.mode === 'text' ? pagesFor(input, section) : undefined);
	const call = <S extends v.GenericSchema>(section: Section, schema: S, extra: { knownTrims?: string[]; knownOptions?: string[] }) =>
		prompt(buildPrompt({ pass: input.pass, section, pagesText: textFor(section), documentNote, ...extra }), schema, {
			model: plan.model,
			documents,
			label: `${input.pass}:${section}:${attempt}`,
		});

	const first = await call('trimsColors', SectionTrimsColors, {});
	const knownTrims = first.trims.map((t) => t.name);
	if (!first.document.isPriceSheet) {
		return { document: first.document, trims: [], colors: [], options: [], rules: [] };
	}
	const { options } = await call('options', SectionOptions, { knownTrims });
	const { rules } = await call('rules', SectionRules, { knownTrims, knownOptions: options.map((o) => o.name) });
	const ex: Extraction = { document: first.document, trims: first.trims, colors: first.colors, options, rules };

	if (doc?.originalPages) {
		const pages = doc.originalPages;
		for (const it of [...ex.trims, ...ex.colors, ...ex.options, ...ex.rules]) it.evidence.page = remapPage(it.evidence.page, pages);
	}
	if (plan.mode === 'text') for (const c of ex.colors) c.hex = null; // text models cannot see colour chips
	return ex;
}

export async function runPass(prompt: PromptFn, input: PassInput): Promise<PassOutput> {
	const fallbackReasons: string[] = [];
	const lookup = input.isScanned ? null : pageLookup(input.rawPages);
	const quality = (ex: Extraction) => checkQuality(ex, { looksLikePriceSheet: input.looksLikePriceSheet, pages: lookup });
	const fallbackPlan = (reason: string) => {
		fallbackReasons.push(reason);
		if (!input.openaiAvailable) throw new ExtractionUnavailableError(`${reason} — OpenAI 키가 없어 폴백할 수 없음`);
		return { mode: 'document' as const, model: MODELS.fallback, reason };
	};

	const plan = planModel(input);
	if (plan.mode === 'unavailable') throw new ExtractionUnavailableError(`${plan.reason} — OpenAI 키가 없어 처리할 수 없음`);
	if (plan.mode === 'document') {
		fallbackReasons.push(plan.reason);
		const ex = await runSections(prompt, input, plan, 'doc');
		return { extraction: ex, model: plan.model, fallback: true, fallbackReasons, quality: quality(ex) };
	}

	// Text mode with GLM: one retry on failure (F3/F5), then OpenAI.
	let ex: Extraction | null = null;
	let lastError: unknown = null;
	for (const attempt of ['t1', 't2']) {
		try {
			ex = await runSections(prompt, input, plan, attempt);
			break;
		} catch (err) {
			lastError = err;
		}
	}
	if (!ex) {
		const msg = lastError instanceof Error ? lastError.message : String(lastError);
		const fb = fallbackPlan(`GLM 추출 2회 실패: ${msg.slice(0, 120)}`);
		const out = await runSections(prompt, input, fb, 'fb');
		return { extraction: out, model: fb.model, fallback: true, fallbackReasons, quality: quality(out) };
	}

	const q = quality(ex);
	if (q.ok) return { extraction: ex, model: plan.model, fallback: false, fallbackReasons, quality: q };

	// F4: poor quality. Fall back when possible, otherwise keep the GLM result (items will be reviewed).
	if (!input.openaiAvailable) {
		fallbackReasons.push(`${q.reason} — OpenAI 키가 없어 GLM 결과를 그대로 사용`);
		return { extraction: ex, model: plan.model, fallback: false, fallbackReasons, quality: q };
	}
	const fb = fallbackPlan(q.reason ?? '품질 점검 실패');
	const out = await runSections(prompt, input, fb, 'fb');
	return { extraction: out, model: fb.model, fallback: true, fallbackReasons, quality: quality(out) };
}
