// Accuracy metrics against human-made golden data (PLAN.md Phase 8.2, project-overview §5).
// Pure functions: no Workers or network imports, so `scripts/eval.ts` can run them under Node.
import { normName, sameSet } from '../pipeline/normalize.ts';
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

/**
 * How applicable-trim lists are compared: result trim names are first mapped to the golden trim
 * they matched, then "*" (전 트림) expands to every golden trim.
 */
export interface TrimContext {
	allTrims: readonly string[];
	alias: ReadonlyMap<string, string>;
}

function trimSet(list: readonly string[], ctx?: TrimContext): string[] {
	if (!ctx) return [...list];
	const out = list.flatMap((t) => (t.trim() === '*' || normName(t) === '전 트림' ? ctx.allTrims : [ctx.alias.get(looseName(t)) ?? t]));
	return [...new Set(out.map(looseName))];
}

const sameTrims = (a: readonly string[], b: readonly string[], ctx?: TrimContext) => sameSet(trimSet(a, ctx), trimSet(b, ctx));

/** Same value under the checks the reviewer cares about (prices, codes, trim sets, rule targets). */
export function sameValues(sheet: keyof EvalReport['sheets'], a: AnyItem, g: AnyItem, ctx?: TrimContext): boolean {
	if (sheet === 'trim') return (a as TrimItem).price === (g as TrimItem).price;
	if (sheet === 'option') {
		const [x, y] = [a as OptionItem, g as OptionItem];
		return x.price === y.price && sameTrims(x.applicableTrims, y.applicableTrims, ctx);
	}
	if (sheet === 'color') {
		const [x, y] = [a as ColorItem, g as ColorItem];
		return normName(x.code ?? '') === normName(y.code ?? '') && sameTrims(x.applicableTrims, y.applicableTrims, ctx);
	}
	return true; // rule matching already covers type, subject and targets
}

const LIST = {
	trim: (e: Golden) => e.trims,
	color: (e: Golden) => e.colors,
	option: (e: Golden) => e.options,
	rule: (e: Golden) => e.rules,
} as const;

const label = (sheet: string, it: AnyItem) => (sheet === 'rule' ? `${(it as RuleItem).subject}→${(it as RuleItem).targets.join(',')}` : (it as { name: string }).name);

/**
 * Loose form for matching names written slightly differently by people and models:
 * no spaces or punctuation, Roman numerals as Latin letters ("테크Ⅰ" = "테크 I" = "테크1").
 */
export function looseName(s: string): string {
	return normName(s)
		.replace(/ⅰ|Ⅰ/g, '1')
		.replace(/ⅱ|Ⅱ/g, '2')
		.replace(/ⅲ|Ⅲ/g, '3')
		.replace(/(?<![a-z])iii(?![a-z])/g, '3')
		.replace(/(?<![a-z])ii(?![a-z])/g, '2')
		.replace(/(?<![a-z])i(?![a-z])/g, '1')
		.replace(/[\s\-·,./()[\]&+'"“”‘’:;!?~_]/g, '');
}

/** Normalised Levenshtein similarity in [0, 1]. */
export function similarity(a: string, b: string): number {
	if (a === b) return 1;
	if (!a || !b) return 0;
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const cur = [i];
		for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		prev = cur;
	}
	return 1 - prev[b.length] / Math.max(a.length, b.length);
}

const digits = (s: string) => s.replace(/\D+/g, ' ').trim();

/** Minimum similarity for a fuzzy name match (catches a dropped/extra character, not different items). */
export const FUZZY_THRESHOLD = 0.85;

function matchName(sheet: keyof EvalReport['sheets'], it: AnyItem): string {
	if (sheet === 'rule') {
		const r = it as RuleItem;
		return `${r.type}|${looseName(r.subject)}|${r.targets.map(looseName).sort().join(',')}`;
	}
	const base = looseName((it as { name: string }).name);
	return sheet === 'color' ? `${(it as ColorItem).kind}|${base}` : base;
}

/**
 * One-to-one matching of golden items to result items. Stage 1 pairs identical loose names
 * (preferring equal values when a name repeats, e.g. one option at two prices); stage 2 pairs the
 * remaining items by similarity ≥ FUZZY_THRESHOLD (rules must also agree on type).
 */
export function matchItems<T extends AnyItem>(
	sheet: keyof EvalReport['sheets'],
	golden: readonly T[],
	results: readonly T[],
	ctx?: TrimContext,
): { pairs: [number, number][]; missing: number[]; extra: number[] } {
	const gName = golden.map((g) => matchName(sheet, g));
	const rName = results.map((r) => matchName(sheet, r));
	const usedG = new Set<number>();
	const usedR = new Set<number>();
	const pairs: [number, number][] = [];
	const take = (gi: number, ri: number) => (pairs.push([gi, ri]), usedG.add(gi), usedR.add(ri));

	for (const preferSame of [true, false]) {
		golden.forEach((g, gi) => {
			if (usedG.has(gi)) return;
			const ri = rName.findIndex((n, i) => !usedR.has(i) && n === gName[gi] && (!preferSame || sameValues(sheet, results[i], g, ctx)));
			if (ri >= 0) take(gi, ri);
		});
	}

	const candidates: { gi: number; ri: number; sim: number }[] = [];
	golden.forEach((g, gi) => {
		if (usedG.has(gi)) return;
		results.forEach((r, ri) => {
			if (usedR.has(ri)) return;
			if (sheet === 'rule' && (r as RuleItem).type !== (g as RuleItem).type) return;
			// Numbers carry meaning (3인승/5인승, 테크1/테크2, 19인치/20인치): never fuzzy across them.
			if (digits(gName[gi]) !== digits(rName[ri])) return;
			const sim = similarity(gName[gi], rName[ri]);
			if (sim >= FUZZY_THRESHOLD) candidates.push({ gi, ri, sim });
		});
	});
	for (const c of candidates.sort((a, b) => b.sim - a.sim)) if (!usedG.has(c.gi) && !usedR.has(c.ri)) take(c.gi, c.ri);

	return {
		pairs,
		missing: golden.map((_, i) => i).filter((i) => !usedG.has(i)),
		extra: results.map((_, i) => i).filter((i) => !usedR.has(i)),
	};
}

export function evaluate(vehicle: string, result: ReconcileResult, golden: Golden): EvalReport {
	const sheets = {} as EvalReport['sheets'];
	const autoWrong: string[] = [];
	let autoTotal = 0;
	let autoCorrect = 0;
	// Trims are matched first so later sheets can compare trim lists by golden trim name.
	const ctx: TrimContext = { allTrims: golden.trims.map((t) => t.name), alias: new Map() };

	for (const sheet of ['trim', 'color', 'option', 'rule'] as const) {
		const goldenList = LIST[sheet](golden) as AnyItem[];
		const items = result.items.filter((i) => i.sheet === sheet);
		const finals = items.map((i) => i.final as AnyItem);
		const m = matchItems(sheet, goldenList, finals, ctx);
		if (sheet === 'trim') {
			for (const [gi, ri] of m.pairs) (ctx.alias as Map<string, string>).set(looseName((finals[ri] as TrimItem).name), (goldenList[gi] as TrimItem).name);
		}
		const goldenFor = new Map(m.pairs.map(([gi, ri]) => [ri, goldenList[gi]]));
		const score: SheetScore = {
			golden: goldenList.length,
			found: m.pairs.length,
			missing: m.missing.map((gi) => label(sheet, goldenList[gi])),
			extra: m.extra.map((ri) => label(sheet, finals[ri])),
			wrong: [],
		};
		items.forEach((it, ri) => {
			const g = goldenFor.get(ri);
			if (g && !sameValues(sheet, finals[ri], g, ctx)) score.wrong.push(label(sheet, finals[ri]));
			if (it.status === '자동 확정') {
				autoTotal++;
				if (g && sameValues(sheet, finals[ri], g, ctx)) autoCorrect++;
				else autoWrong.push(`${sheet}:${label(sheet, finals[ri])}`);
			}
		});
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
