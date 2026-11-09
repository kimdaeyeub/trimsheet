// Page text + glyph positions via unpdf (pdf.js), PLAN.md §7.1.
import { getDocumentProxy } from 'unpdf';

export interface TextItem {
	str: string;
	/** Left edge, PDF user space (origin bottom-left). */
	x: number;
	/** Baseline. */
	y: number;
	w: number;
	h: number;
}

export interface PageText {
	/** 1-based. */
	page: number;
	items: TextItem[];
	/** Reading-order plain text (items joined; line breaks where pdf.js reports them). */
	text: string;
}

interface RawItem {
	str?: string;
	transform?: number[];
	width?: number;
	height?: number;
	hasEOL?: boolean;
}

/** All pages, or only the first `maxPages` (e.g. the cover for identity checks). */
export async function extractPages(bytes: ArrayBuffer, maxPages?: number): Promise<PageText[]> {
	const pdf = await getDocumentProxy(new Uint8Array(bytes.slice(0)));
	try {
		const pages: PageText[] = [];
		const last = maxPages ? Math.min(maxPages, pdf.numPages) : pdf.numPages;
		for (let n = 1; n <= last; n++) {
			const page = await pdf.getPage(n);
			const content = await page.getTextContent();
			const items: TextItem[] = [];
			let text = '';
			for (const raw of content.items as RawItem[]) {
				if (typeof raw.str !== 'string') continue;
				const t = raw.transform ?? [1, 0, 0, 1, 0, 0];
				if (raw.str.trim()) {
					items.push({ str: raw.str, x: t[4], y: t[5], w: raw.width ?? 0, h: raw.height || Math.abs(t[3]) || 10 });
				}
				text += raw.str + (raw.hasEOL ? '\n' : '');
			}
			pages.push({ page: n, items, text: text.replace(/[ \t]+\n/g, '\n').trim() });
			page.cleanup();
		}
		return pages;
	} finally {
		await pdf.cleanup();
	}
}
