// Vehicle identity: model year, family key, vehicle key, price-sheet date (PLAN.md §7.11 (1)).
import type { Brand } from '@shared/types';
import { normName } from './normalize.ts';

const YEAR_PATTERNS: RegExp[] = [
	/(20\d{2})\s*(?:년형|년식|my\b|model\s*year)/gi,
	/(?<![a-z])my\s*'?(\d{2})(?!\d)/gi, // MY26, _MY26_
	/\bthe\s+(20\d{2})\b/gi,
	// A standalone year token in names/labels ("2026 G80 가격표", "G80_2026.pdf") — but not the
	// year of a date such as "2026.11.01" or "2026년 11월".
	/(?:^|[\s_\-(\[])(20\d{2})(?=[\s_\-)\]]|\.pdf\b|$)/gi,
];

/** Highest plausible model year mentioned in any of the texts, else null. Never guesses from bare dates. */
export function parseModelYear(texts: readonly (string | null | undefined)[], now: Date = new Date()): string | null {
	const maxYear = now.getUTCFullYear() + 2;
	let best: number | null = null;
	for (const raw of texts) {
		if (!raw) continue;
		const text = raw.normalize('NFKC');
		for (const re of YEAR_PATTERNS) {
			for (const m of text.matchAll(re)) {
				let y = Number(m[1]);
				if (y < 100) y += 2000;
				if (y >= 2000 && y <= maxYear && (best === null || y > best)) best = y;
			}
		}
	}
	return best === null ? null : String(best);
}

const pad = (n: number) => String(n).padStart(2, '0');

const DATE = String.raw`((?:20)?\d{2})\s*(?:년|[.\-/])\s*(\d{1,2})\s*(?:월|[.\-/])\s*(\d{1,2})\s*일?`;
const EFFECTIVE_DATE_PATTERNS: RegExp[] = [
	// "2026년 11월 1일 기준", "2026.11.01 시행", "26년 4월 23일 기준", "2026년 11월 1일, 개별 소비세 5% 기준"
	new RegExp(`(?<!\\d)${DATE}\\s*(?:부터\\s*)?(?:[^\\n|]{0,20}?(?:기준|시행|적용)|부(?=[\\s)]|$))`, 'g'),
	// "현 모델 출시일 : 26년 4월 23일"
	new RegExp(`(?:출시일|기준일|시행일)\\s*[:：]?\\s*${DATE}`, 'g'),
];

/**
 * Price-sheet date → "YYYY-MM-DD". Needs a cue: 기준/시행/적용 after the date (up to ~20 chars later,
 * e.g. "2026년 11월 1일, 개별 소비세 5% 기준") or 출시일/기준일 before it. Two-digit years mean 20YY.
 */
export function parseEffectiveDate(texts: readonly (string | null | undefined)[]): string | null {
	for (const raw of texts) {
		if (!raw) continue;
		const text = raw.normalize('NFKC');
		for (const re of EFFECTIVE_DATE_PATTERNS) {
			for (const m of text.matchAll(re)) {
				let y = Number(m[1]);
				if (y < 100) y += 2000;
				const [mo, d] = [Number(m[2]), Number(m[3])];
				if (y >= 2000 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
			}
		}
	}
	return null;
}

const BRAND_WORDS: [Brand, RegExp][] = [
	['genesis', /제네시스|genesis|\bgv?\d{2}\b/i],
	['kia', /기아|\bkia\b/i],
	['hyundai', /현대|hyundai/i],
];

export function guessBrand(texts: readonly (string | null | undefined)[]): Brand | null {
	for (const [brand, re] of BRAND_WORDS) if (texts.some((t) => t && re.test(t.normalize('NFKC')))) return brand;
	return null;
}

/** Marketing / document words removed when deriving the family key. Powertrain and body words stay. */
export const FAMILY_STOP_WORDS = [
	'디 올 뉴',
	'디 올뉴',
	'디올뉴',
	'더 뉴',
	'더뉴',
	'all new',
	'the new',
	'the',
	'new',
	'신형',
	'페이스리프트',
	'facelift',
	'연식변경',
	'가격표',
	'가격',
	'카탈로그',
	'price list',
	'pricelist',
	'price',
	'catalog',
	'현대자동차',
	'현대',
	'hyundai',
	'기아',
	'kia',
	'제네시스',
	'genesis',
];

/** Display-name variants that refer to the same family (normalised → canonical). */
export const FAMILY_ALIASES: Record<string, string> = {
	'g80 electrified': 'g80 전동화',
	'electrified g80': 'g80 전동화',
	'스타리아 ev': '스타리아 electric',
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Normalised family name without year or marketing words, e.g. "더 뉴 G80 2026년형" → "g80". */
export function familyName(name: string): string | null {
	let s = normName(name)
		.replace(/\.pdf$/, '')
		.replace(/[_]+/g, ' ')
		.replace(/(20\d{2})\s*(년형|년식|my|model year)?/g, ' ')
		.replace(/\bmy\s*'?\d{2}\b/g, ' ');
	for (const w of FAMILY_STOP_WORDS) s = s.replace(new RegExp(`(^|\\s)${escape(w)}(?=\\s|$)`, 'g'), ' ');
	s = s.replace(/[()[\]"'“”‘’]/g, ' ').replace(/\s+/g, ' ').trim();
	if (!s) return null;
	return FAMILY_ALIASES[s] ?? s;
}

export const familyKey = (brand: Brand, name: string): string | null => {
	const fam = familyName(name);
	return fam ? `${brand}|${fam}` : null;
};

export const vehicleKey = (family: string, modelYear: string) => `${family}|${modelYear}`;

export interface VehicleIdentity {
	brand: Brand | null;
	name: string | null;
	modelYear: string | null;
	/**
	 * Where modelYear came from. Real price sheets often have no "20XX년형" (none of the 2026-11
	 * Hyundai/Kia/Genesis samples did), so the year falls back to the price-sheet date, then to the
	 * date the file was first seen. Only 'stated' is an explicit model year.
	 */
	modelYearSource: 'stated' | 'effective_date' | 'first_seen' | null;
	effectiveDate: string | null;
	familyKey: string | null;
	vehicleKey: string | null;
}

/**
 * Identity from cheap signals (no LLM): explicit name/brand when known (crawler, LLM document info),
 * otherwise file name / link label / cover-page text.
 */
export function identify(input: {
	name?: string | null;
	brand?: Brand | null;
	modelYear?: string | null;
	effectiveDate?: string | null;
	filename?: string | null;
	label?: string | null;
	coverText?: string | null;
	/** ISO date the file was first seen (download/upload). Last-resort model-year source. */
	firstSeen?: string | null;
	now?: Date;
}): VehicleIdentity {
	const texts = [input.name, input.label, input.filename, input.coverText];
	const brand = input.brand ?? guessBrand(texts);
	const name = input.name ?? input.label ?? null;
	const effectiveDate = input.effectiveDate ?? parseEffectiveDate([input.coverText, input.label]);
	const stated = input.modelYear ?? parseModelYear(texts, input.now);
	const fromFirstSeen = input.firstSeen ? /^(20\d{2})-/.exec(input.firstSeen)?.[1] ?? null : null;
	const [modelYear, modelYearSource]: [string | null, VehicleIdentity['modelYearSource']] = stated
		? [stated, 'stated']
		: effectiveDate
			? [effectiveDate.slice(0, 4), 'effective_date']
			: fromFirstSeen
				? [fromFirstSeen, 'first_seen']
				: [null, null];
	const fam = brand && name ? familyKey(brand, name) : null;
	return {
		brand,
		name,
		modelYear,
		modelYearSource,
		effectiveDate,
		familyKey: fam,
		vehicleKey: fam && modelYear ? vehicleKey(fam, modelYear) : null,
	};
}
