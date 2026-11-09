// Rebuild table-like lines from glyph positions so a text-only model (GLM) can read
// price tables row by row (PLAN.md §7.2). Merged cells are not reconstructed.
import type { PageText, TextItem } from './pdf-text.ts';

const median = (xs: number[]) => {
	if (xs.length === 0) return 0;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)];
};

/** Group items into lines (top to bottom) and join with " | " at wide gaps. */
export function layoutLines(items: readonly TextItem[]): string[] {
	if (items.length === 0) return [];
	const tol = Math.max(1, median(items.map((i) => i.h)) * 0.5);
	const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);

	const lines: TextItem[][] = [];
	for (const item of sorted) {
		const line = lines.find((l) => Math.abs(l[0].y - item.y) <= tol);
		if (line) line.push(item);
		else lines.push([item]);
	}
	lines.sort((a, b) => b[0].y - a[0].y);

	return lines.map((line) => {
		line.sort((a, b) => a.x - b.x);
		let out = '';
		let prev: TextItem | null = null;
		for (const it of line) {
			if (prev) {
				const charW = prev.w / Math.max(1, [...prev.str].length) || it.h * 0.5;
				const gap = it.x - (prev.x + prev.w);
				if (gap > charW * 2) out += ' | ';
				else if (gap > charW * 0.15 && !out.endsWith(' ') && !it.str.startsWith(' ')) out += ' ';
			}
			out += it.str;
			prev = it;
		}
		return out.replace(/\s+/g, ' ').trim();
	}).filter(Boolean);
}

export interface LayoutPage {
	page: number;
	text: string;
}

export function buildLayout(pages: readonly PageText[]): LayoutPage[] {
	return pages.map((p) => ({ page: p.page, text: layoutLines(p.items).join('\n') }));
}

/** Prompt-ready text with `=== p.N ===` page markers, optionally limited to some pages. */
export function renderPages(pages: readonly { page: number; text: string }[], only?: ReadonlySet<number>): string {
	return pages
		.filter((p) => !only || only.has(p.page))
		.map((p) => `=== p.${p.page} ===\n${p.text}`)
		.join('\n\n');
}
