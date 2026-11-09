// Rule checks on extracted values (PLAN.md §7.6). Pure functions returning review reasons.
import type { ReviewReason } from '@shared/types';
import { itemKey, normName } from './normalize.ts';
import type { ColorItem, EvidenceT, Extraction, OptionItem, RuleItem, TrimItem } from './schema.ts';

export interface ValidationContext {
	pageCount: number;
	trimNames: Set<string>;
	optionNames: Set<string>;
}

export function contextFor(ex: Extraction, pageCount: number): ValidationContext {
	return {
		pageCount,
		trimNames: new Set(ex.trims.map((t) => normName(t.name))),
		optionNames: new Set(ex.options.map((o) => normName(o.name))),
	};
}

const MAX_PRICE = 300_000_000;

function priceReasons(price: number | null): ReviewReason[] {
	if (price === null) return [];
	if (!Number.isInteger(price) || price <= 0 || price >= MAX_PRICE) return [{ code: 'INVALID_PRICE', detail: String(price) }];
	return [];
}

function common(item: { confidence: string; evidence: EvidenceT }, ctx: ValidationContext): ReviewReason[] {
	const out: ReviewReason[] = [];
	if (item.confidence !== 'high') out.push({ code: 'LOW_CONFIDENCE', detail: item.confidence });
	if (item.evidence.page < 1 || item.evidence.page > ctx.pageCount) {
		out.push({ code: 'EVIDENCE_NOT_FOUND', detail: `p.${item.evidence.page}는 문서 범위 밖` });
	}
	return out;
}

function unknownTrims(names: readonly string[], ctx: ValidationContext): string[] {
	return names.filter((n) => n !== '*' && !ctx.trimNames.has(normName(n)));
}

export const validateTrim = (t: TrimItem, ctx: ValidationContext) => [...priceReasons(t.price), ...common(t, ctx)];

export function validateColor(c: ColorItem, ctx: ValidationContext): ReviewReason[] {
	const out = common(c, ctx);
	const unknown = unknownTrims(c.applicableTrims, ctx);
	if (unknown.length) out.push({ code: 'UNKNOWN_REFERENCE', detail: `없는 트림: ${unknown.join(', ')}` });
	return out;
}

export function validateOption(o: OptionItem, ctx: ValidationContext): ReviewReason[] {
	const out = [...priceReasons(o.price), ...common(o, ctx)];
	const unknown = unknownTrims(o.applicableTrims, ctx);
	if (unknown.length) out.push({ code: 'UNKNOWN_REFERENCE', detail: `없는 트림: ${unknown.join(', ')}` });
	return out;
}

export function validateRule(r: RuleItem, ctx: ValidationContext): ReviewReason[] {
	const out = common(r, ctx);
	if (r.type === 'other') out.push({ code: 'RULE_OTHER' });
	const known = (n: string) => ctx.optionNames.has(normName(n)) || ctx.trimNames.has(normName(n));
	const missing = [r.subject, ...r.targets].filter((n) => !known(n));
	if (missing.length) out.push({ code: 'UNKNOWN_REFERENCE', detail: `없는 항목: ${missing.join(', ')}` });
	if (r.type === 'trim_only') {
		const notTrims = r.targets.filter((t) => !ctx.trimNames.has(normName(t)));
		if (notTrims.length) out.push({ code: 'UNKNOWN_REFERENCE', detail: `트림이 아님: ${notTrims.join(', ')}` });
	}
	return out;
}

/**
 * Contradictions across rules: the same (subject, target) pair marked both exclusive and
 * requires/includes, or A requires B while B excludes A. Returns reasons keyed by rule key.
 */
export function ruleConflicts(rules: readonly RuleItem[]): Map<string, ReviewReason[]> {
	const pair = (a: string, b: string) => `${normName(a)}→${normName(b)}`;
	const exclusive = new Set<string>();
	const positive = new Set<string>();
	for (const r of rules) {
		for (const t of r.targets) {
			if (r.type === 'exclusive') {
				exclusive.add(pair(r.subject, t));
				exclusive.add(pair(t, r.subject)); // exclusion is symmetric
			} else if (r.type === 'requires' || r.type === 'includes') positive.add(pair(r.subject, t));
		}
	}
	const out = new Map<string, ReviewReason[]>();
	for (const r of rules) {
		if (r.type === 'other' || r.type === 'trim_only') continue;
		const clash = r.targets.filter((t) => {
			const p = pair(r.subject, t);
			return r.type === 'exclusive' ? positive.has(p) || positive.has(pair(t, r.subject)) : exclusive.has(p);
		});
		if (clash.length) out.set(itemKey.rule(r), [{ code: 'RULE_CONFLICT', detail: `${r.subject} ↔ ${clash.join(', ')}` }]);
	}
	return out;
}
