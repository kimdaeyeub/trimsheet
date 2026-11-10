// Text normalisation shared by matching, evidence checks and vehicle identity.

/** NFKC, unified brackets/dots, collapsed whitespace, lowercase Latin. */
export function normName(s: string): string {
	return s
		.normalize('NFKC')
		.replace(/[［【〔｛]/g, '[')
		.replace(/[］】〕｝]/g, ']')
		.replace(/[ㆍᆞ·•・]/g, '·')
		.replace(/[‐‑‒–—―]/g, '-')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/** normName without any whitespace — for substring checks against PDF text. */
export const compact = (s: string) => normName(s).replace(/\s+/g, '');

/**
 * "41,250,000원" → 41250000, "4,125만원" → 41250000, "4,125.5만" → 41255000.
 * Returns null when no amount is found.
 */
export function parsePrice(input: string): number | null {
	const s = input.normalize('NFKC').replace(/\s+/g, '');
	const man = /(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)만(?:원)?/.exec(s);
	if (man) return Math.round(Number(man[1].replaceAll(',', '')) * 10_000);
	const plain = /(-?\d{1,3}(?:,\d{3})+|-?\d+)(?:원)?/.exec(s);
	if (!plain) return null;
	return Number(plain[1].replaceAll(',', ''));
}

/** Set equality after normalisation, order-insensitive. */
export function sameSet(a: readonly string[], b: readonly string[]): boolean {
	const na = new Set(a.map(normName));
	const nb = new Set(b.map(normName));
	return na.size === nb.size && [...na].every((x) => nb.has(x));
}

/** Matching keys per sheet (PLAN.md §7.5). */
export const itemKey = {
	trim: (t: { name: string }) => normName(t.name),
	color: (c: { kind: string; name: string }) => `${c.kind}|${normName(c.name)}`,
	option: (o: { name: string }) => normName(o.name),
	rule: (r: { type: string; subject: string; targets: readonly string[] }) =>
		`${r.type}|${normName(r.subject)}|${r.targets.map(normName).sort().join(',')}`,
};

/**
 * Second key part, used only when a name repeats within one list: the same option at a different
 * price per trim (스타리아 내비플러스 110만/105만), or the same colour name under two codes (G80 비크 블랙
 * PH3/NXX). Unique names keep the plain key so a misread price still pairs up as a PASS_MISMATCH.
 */
export const itemDisc = {
	trim: (t: { price: number | null }) => String(t.price ?? ''),
	color: (c: { code: string | null }) => normName(c.code ?? ''),
	option: (o: { price: number | null }) => String(o.price ?? ''),
	rule: () => '',
};

/** Keys for one or more lists of the same sheet, disambiguating names that repeat in any list. */
export function keysFor<T>(lists: readonly (readonly T[])[], key: (i: T) => string, disc: (i: T) => string): (i: T) => string {
	const repeated = new Set<string>();
	for (const list of lists) {
		const seen = new Set<string>();
		for (const it of list) {
			const k = key(it);
			if (seen.has(k)) repeated.add(k);
			seen.add(k);
		}
	}
	return (i) => {
		const k = key(i);
		return repeated.has(k) ? `${k}|${disc(i)}` : k;
	};
}
