// Accuracy metrics against human-made golden data (PLAN.md Phase 8.2, project-overview §5).
// Pure functions: no Workers or network imports, so `scripts/eval.ts` can run them under Node.
import { itemKey, normName, sameSet } from '../pipeline/normalize.ts';
import type { ReconcileResult } from '../pipeline/reconcile.ts';
import type { ColorItem, Extraction, OptionItem, RuleItem, TrimItem } from '../pipeline/schema.ts';

export type Golden = Pick<Extraction, 'trims' | 'colors' | 'options' | 'rules'>;

export interface SheetScore {
	golden: number;
	found: number;
	missing: string[];
	extra: string[];
	/** Found items whose values differ from the golden data. */
	wrong: string[];
}

export interface EvalReport {
	vehicle: string;
	auto: { total: number; correct: number; accuracy: number | null; wrong: string[] };
	sheets: Record<'trim' | 'color' | 'option' | 'rule', SheetScore>;
	/** Golden rules present in the result (auto or 확인 필요). Target ≥ 95%. */
	ruleRecall: number | null;
	/** Missing trims + options + trims/options with a wrong price. Target 0. */
	criticalMisses: number;
	pass: { autoAccuracy: boolean; noMissing: boolean; ruleRecall: boolean };
}

type AnyItem = TrimItem | ColorItem | OptionItem | RuleItem;

/** Same value under the checks the reviewer cares about (prices, codes, trim sets, rule targets). */
export function sameValues(sheet: keyof EvalReport['sheets'], a: AnyItem, g: AnyItem): boolean {
	if (sheet === 'trim') return (a as TrimItem).price === (g as TrimItem).price;
	if (sheet === 'option') {
		const [x, y] = [a as OptionItem, g as OptionItem];
		return x.price === y.price && sameSet(x.applicableTrims, y.applicableTrims);
	}
	if (sheet === 'color') {
		const [x, y] = [a as ColorItem, g as ColorItem];
		return normName(x.code ?? '') === normName(y.code ?? '') && sameSet(x.applicableTrims, y.applicableTrims);
	}
	return true; // rule keys already encode type, subject and targets
}

const KEYS = { trim: itemKey.trim, color: itemKey.color, option: itemKey.option, rule: itemKey.rule } as const;
const LIST = {
	trim: (e: Golden) => e.trims,
	color: (e: Golden) => e.colors,
	option: (e: Golden) => e.options,
	rule: (e: Golden) => e.rules,
} as const;

const label = (sheet: string, it: AnyItem) => (sheet === 'rule' ? `${(it as RuleItem).subject}→${(it as RuleItem).targets.join(',')}` : (it as { name: string }).name);

export function evaluate(vehicle: string, result: ReconcileResult, golden: Golden): EvalReport {
	const sheets = {} as EvalReport['sheets'];
	const autoWrong: string[] = [];
	let autoTotal = 0;
	let autoCorrect = 0;

	for (const sheet of ['trim', 'color', 'option', 'rule'] as const) {
		const key = KEYS[sheet] as (i: AnyItem) => string;
		const goldenMap = new Map(LIST[sheet](golden).map((g) => [key(g as AnyItem), g as AnyItem]));
		const items = result.items.filter((i) => i.sheet === sheet);
		const resultKeys = new Set(items.map((i) => i.key));
		const score: SheetScore = { golden: goldenMap.size, found: 0, missing: [], extra: [], wrong: [] };

		for (const [k, g] of goldenMap) {
			if (!resultKeys.has(k)) score.missing.push(label(sheet, g));
		}
		for (const it of items) {
			const g = goldenMap.get(it.key);
			const final = it.final as AnyItem;
			if (!g) score.extra.push(label(sheet, final));
			else {
				score.found++;
				if (!sameValues(sheet, final, g)) score.wrong.push(label(sheet, final));
			}
			if (it.status === '자동 확정') {
				autoTotal++;
				if (g && sameValues(sheet, final, g)) autoCorrect++;
				else autoWrong.push(`${sheet}:${label(sheet, final)}`);
			}
		}
		sheets[sheet] = score;
	}

	const ruleRecall = sheets.rule.golden ? sheets.rule.found / sheets.rule.golden : null;
	const criticalMisses = sheets.trim.missing.length + sheets.option.missing.length + sheets.trim.wrong.length + sheets.option.wrong.length;
	const accuracy = autoTotal ? autoCorrect / autoTotal : null;
	return {
		vehicle,
		auto: { total: autoTotal, correct: autoCorrect, accuracy, wrong: autoWrong },
		sheets,
		ruleRecall,
		criticalMisses,
		pass: {
			autoAccuracy: accuracy === null || accuracy >= 0.99,
			noMissing: criticalMisses === 0,
			ruleRecall: ruleRecall === null || ruleRecall >= 0.95,
		},
	};
}

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
const ok = (b: boolean) => (b ? '✅' : '❌');

export function toMarkdown(reports: EvalReport[], generatedAt: string): string {
	const rows = reports.map(
		(r) =>
			`| ${r.vehicle} | ${pct(r.auto.accuracy)} (${r.auto.correct}/${r.auto.total}) ${ok(r.pass.autoAccuracy)} | ${r.criticalMisses} ${ok(r.pass.noMissing)} | ${pct(r.ruleRecall)} ${ok(r.pass.ruleRecall)} |`,
	);
	const details = reports.map((r) => {
		const lines = [`### ${r.vehicle}`];
		for (const [sheet, s] of Object.entries(r.sheets)) {
			lines.push(`- **${sheet}**: 정답 ${s.golden} · 찾음 ${s.found} · 누락 ${s.missing.length} · 값 다름 ${s.wrong.length} · 정답에 없음 ${s.extra.length}`);
			if (s.missing.length) lines.push(`  - 누락: ${s.missing.join(', ')}`);
			if (s.wrong.length) lines.push(`  - 값 다름: ${s.wrong.join(', ')}`);
		}
		if (r.auto.wrong.length) lines.push(`- **자동 확정인데 틀림**: ${r.auto.wrong.join(', ')}`);
		return lines.join('\n');
	});
	return [
		'# TrimSheet 정확도 평가',
		'',
		`생성: ${generatedAt} · 목표: 자동 확정 정확도 ≥ 99%, 트림·가격·옵션 누락 0, 규칙 재현율 ≥ 95%`,
		'',
		'| 차종 | 자동 확정 정확도 | 트림·옵션 누락/가격 오류 | 규칙 재현율 |',
		'| --- | --- | --- | --- |',
		...rows,
		'',
		...details,
		'',
	].join('\n');
}
