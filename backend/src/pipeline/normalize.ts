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
