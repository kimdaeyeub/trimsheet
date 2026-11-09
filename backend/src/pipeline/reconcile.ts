// Compare pass A and pass B, run checks, decide 자동 확정 / 확인 필요 (PLAN.md §7.7).
import type { ReviewCode, ReviewReason, SheetName } from '@shared/types';
import { verifyQuote, type PageLookup } from './evidence.ts';
import { itemKey, normName, sameSet } from './normalize.ts';
import type { ColorItem, Extraction, OptionItem, RuleItem, TrimItem } from './schema.ts';
import { contextFor, ruleConflicts, validateColor, validateOption, validateRule, validateTrim, type ValidationContext } from './validate.ts';

export type ItemStatus = '자동 확정' | '확인 필요';

/** Informational codes never make an item "확인 필요" by themselves. */
export const INFO_ONLY_CODES: readonly ReviewCode[] = ['FALLBACK_MODEL', 'HEX_APPROX'];

type ItemOf = { trim: TrimItem; color: ColorItem; option: OptionItem; rule: RuleItem };

export interface ReconciledItem<S extends SheetName = SheetName> {
	sheet: S;
	key: string;
	final: ItemOf[S];
	passA: ItemOf[S] | null;
	passB: ItemOf[S] | null;
	reasons: ReviewReason[];
	status: ItemStatus;
}

export interface ReconcileResult {
	document: Extraction['document'];
	items: ReconciledItem[];
	counts: { trims: number; colors: number; options: number; rules: number; review: number };
}

export interface ReconcileOptions {
	pageCount: number;
	/** Page text for evidence checks; null for scanned PDFs (no text layer). */
	pages: PageLookup | null;
	scanned: boolean;
	fallbackA?: boolean;
	fallbackB?: boolean;
}

function indexBy<T>(items: readonly T[], key: (i: T) => string): { map: Map<string, T>; dupes: Set<string> } {
	const map = new Map<string, T>();
	const dupes = new Set<string>();
	for (const it of items) {
		const k = key(it);
		if (map.has(k)) dupes.add(k);
		else map.set(k, it);
	}
	return { map, dupes };
}

const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '없음' : String(v));

/** Which fields differ between the two passes (empty = agree). */
export function compareFields(sheet: SheetName, a: ItemOf[SheetName], b: ItemOf[SheetName]): string[] {
	const diffs: string[] = [];
	const diff = (label: string, x: unknown, y: unknown) => diffs.push(`${label}: ${fmt(x)} / ${fmt(y)}`);
	if (sheet === 'trim' || sheet === 'option') {
		const [x, y] = [a as TrimItem | OptionItem, b as TrimItem | OptionItem];
		if (x.price !== y.price) diff('가격', x.price, y.price);
	}
	if (sheet === 'color') {
		const [x, y] = [a as ColorItem, b as ColorItem];
		if (normName(x.code ?? '') !== normName(y.code ?? '')) diff('색상 코드', x.code, y.code);
		if (!sameSet(x.applicableTrims, y.applicableTrims)) diff('적용 트림', x.applicableTrims.join(','), y.applicableTrims.join(','));
	}
	if (sheet === 'option') {
		const [x, y] = [a as OptionItem, b as OptionItem];
		if (!sameSet(x.applicableTrims, y.applicableTrims)) diff('적용 트림', x.applicableTrims.join(','), y.applicableTrims.join(','));
		if (!sameSet(x.includes, y.includes)) diff('포함 사양', `${x.includes.length}개`, `${y.includes.length}개`);
	}
	return diffs; // rules: the key already covers type, subject and targets
}

function validate(sheet: SheetName, item: ItemOf[SheetName], ctx: ValidationContext): ReviewReason[] {
	switch (sheet) {
		case 'trim':
			return validateTrim(item as TrimItem, ctx);
		case 'color':
			return validateColor(item as ColorItem, ctx);
		case 'option':
			return validateOption(item as OptionItem, ctx);
		case 'rule':
			return validateRule(item as RuleItem, ctx);
	}
}

/** Merge both passes into the final list used for name lookups (A first). */
function mergedForContext(a: Extraction, b: Extraction | null): Extraction {
	if (!b) return a;
	const names = new Set(a.trims.map((t) => normName(t.name)));
	const opts = new Set(a.options.map((o) => normName(o.name)));
	return {
		...a,
		trims: [...a.trims, ...b.trims.filter((t) => !names.has(normName(t.name)))],
		options: [...a.options, ...b.options.filter((o) => !opts.has(normName(o.name)))],
	};
}

export function reconcile(a: Extraction, b: Extraction | null, opts: ReconcileOptions): ReconcileResult {
	const ctx = contextFor(mergedForContext(a, b), opts.pageCount);
	const items: ReconciledItem[] = [];

	const processSheet = <S extends SheetName>(sheet: S, la: ItemOf[S][], lb: ItemOf[S][] | null, key: (i: ItemOf[S]) => string) => {
		const A = indexBy(la, key);
		const B = lb ? indexBy(lb, key) : null;
		const keys = new Set([...A.map.keys(), ...(B ? B.map.keys() : [])]);
		for (const k of keys) {
			const ia = A.map.get(k) ?? null;
			const ib = B?.map.get(k) ?? null;
			const final = (ia ?? ib)!;
			const reasons: ReviewReason[] = [];

			if (B) {
				if (!ia) reasons.push({ code: 'ONLY_IN_B' });
				else if (!ib) reasons.push({ code: 'ONLY_IN_A' });
				else {
					const diffs = compareFields(sheet, ia, ib);
					if (diffs.length) reasons.push({ code: 'PASS_MISMATCH', detail: diffs.join('; ') });
				}
			}
			if (A.dupes.has(k) || B?.dupes.has(k)) reasons.push({ code: 'DUPLICATE' });
			reasons.push(...validate(sheet, final, ctx));

			if (opts.scanned) reasons.push({ code: 'SCANNED_PDF' });
			else if (opts.pages && !verifyQuote(opts.pages, final.evidence.page, final.evidence.quote)) {
				reasons.push({ code: 'EVIDENCE_NOT_FOUND', detail: `p.${final.evidence.page}에서 "${final.evidence.quote}"를 찾지 못함` });
			}

			const fromFallback = ia ? opts.fallbackA : opts.fallbackB;
			if (fromFallback) reasons.push({ code: 'FALLBACK_MODEL' });
			if (sheet === 'color' && (final as ColorItem).hex) reasons.push({ code: 'HEX_APPROX' });

			items.push({ sheet, key: k, final, passA: ia, passB: ib, reasons, status: '자동 확정' } as ReconciledItem);
		}
	};

	processSheet('trim', a.trims, b?.trims ?? null, itemKey.trim);
	processSheet('color', a.colors, b?.colors ?? null, itemKey.color);
	processSheet('option', a.options, b?.options ?? null, itemKey.option);
	processSheet('rule', a.rules, b?.rules ?? null, itemKey.rule);

	// Cross-rule contradictions.
	const conflicts = ruleConflicts(items.filter((i) => i.sheet === 'rule').map((i) => i.final as RuleItem));
	for (const it of items) if (it.sheet === 'rule') it.reasons.push(...(conflicts.get(it.key) ?? []));

	for (const it of items) {
		it.status = it.reasons.some((r) => !INFO_ONLY_CODES.includes(r.code)) ? '확인 필요' : '자동 확정';
	}

	const count = (s: SheetName) => items.filter((i) => i.sheet === s).length;
	return {
		document: a.document,
		items,
		counts: {
			trims: count('trim'),
			colors: count('color'),
			options: count('option'),
			rules: count('rule'),
			review: items.filter((i) => i.status === '확인 필요').length,
		},
	};
}

/** Short human-readable summary of an item, used in the 확인필요 tab. */
export function summarize(sheet: SheetName, item: ItemOf[SheetName] | null): string {
	if (!item) return '없음';
	const won = (n: number | null) => (n === null ? '가격 없음' : `${n.toLocaleString('ko-KR')}원`);
	switch (sheet) {
		case 'trim': {
			const t = item as TrimItem;
			return `${t.name} · ${won(t.price)}`;
		}
		case 'color': {
			const c = item as ColorItem;
			return `${c.name}${c.code ? ` (${c.code})` : ''} · ${c.applicableTrims.join(', ') || '트림 없음'}`;
		}
		case 'option': {
			const o = item as OptionItem;
			return `${o.name} · ${won(o.price)} · ${o.applicableTrims.join(', ') || '트림 없음'}`;
		}
		case 'rule': {
			const r = item as RuleItem;
			return `${r.condition} → ${r.result}`;
		}
	}
}

export function itemLabel(sheet: SheetName, item: ItemOf[SheetName]): string {
	return sheet === 'rule' ? `${(item as RuleItem).subject} (${(item as RuleItem).type})` : (item as { name: string }).name;
}
