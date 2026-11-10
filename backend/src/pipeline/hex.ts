// Approximate hex codes from colour chips in the PDF (PLAN.md §7.10).
// Chips are found two ways from pdf.js' operator list (formats verified against pdf.js 6.4):
//   - vector swatches: `setFillRGBColor ["#rrggbb"]` + a filled `constructPath` with a chip-sized bbox
//   - raster swatches: `paintImageXObject [objId]` (unit square under the CTM) + pixels from extractImages
// Each chip is matched to the colour name printed closest to it. Values are always approximate.
import { extractImages, getDocumentProxy, getResolvedPDFJS } from 'unpdf';
import { compact, itemKey } from './normalize.ts';
import { extractPages } from './pdf-text.ts';
import type { Extraction } from './schema.ts';
import type { TextItem } from './pdf-text.ts';

export interface Chip {
	page: number;
	x: number;
	y: number;
	w: number;
	h: number;
	hex: string;
	source: 'vector' | 'image';
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
	n[0] * m[0] + n[1] * m[2],
	n[0] * m[1] + n[1] * m[3],
	n[2] * m[0] + n[3] * m[2],
	n[2] * m[1] + n[3] * m[3],
	n[4] * m[0] + n[5] * m[2] + m[4],
	n[4] * m[1] + n[5] * m[3] + m[5],
];
const apply = (m: Matrix, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] as const;

function rectOf(m: Matrix, x0: number, y0: number, x1: number, y1: number) {
	const pts = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)];
	const xs = pts.map((p) => p[0]);
	const ys = pts.map((p) => p[1]);
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Swatch-sized. Vector fills: 6–150 pt, near-square (bars and table cells are vector too).
 * Images: up to 200 pt and 8:1 — real price sheets crop paint photos into wide strips
 * (Kia 107×36, Hyundai 178×23).
 */
export function chipSized(w: number, h: number, source: Chip['source'] = 'vector'): boolean {
	const [max, maxRatio] = source === 'image' ? [200, 8] : [150, 2.5];
	if (w < 6 || h < 6 || w > max || h > max) return false;
	const ratio = w / h;
	return ratio >= 1 / maxRatio && ratio <= maxRatio;
}

type Rect = { x: number; y: number; w: number; h: number };
function intersect(a: Rect, b: Rect | null): Rect | null {
	if (!b) return a;
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	const w = Math.min(a.x + a.w, b.x + b.w) - x;
	const h = Math.min(a.y + a.h, b.y + b.h) - y;
	return w > 0 && h > 0 ? { x, y, w, h } : null;
}

const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/**
 * Median colour of the central 80% of an image, plus whether it is (roughly) one colour.
 * Glossy paint renders are accepted; photos and gradients are rejected.
 */
export function representativeColor(
	data: ArrayLike<number>,
	width: number,
	height: number,
	channels: 1 | 3 | 4,
): { hex: string; uniform: boolean; share: number } {
	const x0 = Math.floor(width * 0.1);
	const x1 = Math.max(x0 + 1, Math.ceil(width * 0.9));
	const y0 = Math.floor(height * 0.1);
	const y1 = Math.max(y0 + 1, Math.ceil(height * 0.9));
	const r: number[] = [];
	const g: number[] = [];
	const b: number[] = [];
	for (let y = y0; y < y1; y++) {
		for (let x = x0; x < x1; x++) {
			const i = (y * width + x) * channels;
			if (channels === 1) (r.push(data[i]), g.push(data[i]), b.push(data[i]));
			else (r.push(data[i]), g.push(data[i + 1]), b.push(data[i + 2]));
		}
	}
	const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1] ?? 0;
	const [mr, mg, mb] = [med([...r]), med([...g]), med([...b])];
	let close = 0;
	for (let i = 0; i < r.length; i++) if (Math.abs(r[i] - mr) <= 24 && Math.abs(g[i] - mg) <= 24 && Math.abs(b[i] - mb) <= 24) close++;
	const share = r.length ? close / r.length : 0;
	// Metallic / pearl paint renders have highlights; 30% of pixels near the median is enough.
	return { hex: toHex(mr, mg, mb), uniform: share >= 0.3, share };
}

interface OperatorList {
	fnArray: number[];
	argsArray: unknown[][];
}

/** Walk one page's drawing operations and collect chip-sized swatches. */
export function chipsFromOperators(
	page: number,
	ops: OperatorList,
	OPS: Record<string, number>,
	images: Map<string, { hex: string; uniform: boolean }>,
): Chip[] {
	const fillOps = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
	const stack: { ctm: Matrix; fill: string | null; clip: Rect | null }[] = [];
	let ctm: Matrix = IDENTITY;
	let fill: string | null = null;
	// Clip region (bbox) of the current graphics state. A clip op marks the next path as the clip.
	let clip: Rect | null = null;
	let clipNext = false;
	const chips: Chip[] = [];

	ops.fnArray.forEach((fn, i) => {
		const args = ops.argsArray[i];
		switch (fn) {
			case OPS.save:
				stack.push({ ctm, fill, clip });
				break;
			case OPS.restore: {
				const s = stack.pop();
				if (s) ({ ctm, fill, clip } = s);
				break;
			}
			case OPS.clip:
			case OPS.eoClip:
				clipNext = true;
				break;
			case OPS.transform:
				ctm = multiply(ctm, args as unknown as Matrix);
				break;
			case OPS.setFillRGBColor: {
				const v = args?.[0];
				fill = typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : null;
				break;
			}
			case OPS.constructPath: {
				const paintOp = args?.[0] as number;
				const bbox = args?.[2] as ArrayLike<number> | undefined;
				if (clipNext && bbox && bbox.length === 4) {
					clip = intersect(rectOf(ctm, bbox[0], bbox[1], bbox[2], bbox[3]), clip) ?? { x: 0, y: 0, w: 0, h: 0 };
					clipNext = false;
				}
				if (!fill || !fillOps.has(paintOp) || !bbox || bbox.length !== 4) break;
				const r = rectOf(ctm, bbox[0], bbox[1], bbox[2], bbox[3]);
				if (chipSized(r.w, r.h)) chips.push({ page, ...r, hex: fill, source: 'vector' });
				break;
			}
			case OPS.paintImageXObject: {
				const img = images.get(String(args?.[0]));
				if (!img?.uniform) break;
				// The visible part: paint photos are often larger images cropped by a clip path.
				const r = intersect(rectOf(ctm, 0, 0, 1, 1), clip);
				if (r && chipSized(r.w, r.h, 'image')) chips.push({ page, ...r, hex: img.hex, source: 'image' });
				break;
			}
		}
	});
	return chips;
}

export async function findChips(bytes: ArrayBuffer, pages: number[]): Promise<Chip[]> {
	const pdfjs = (await getResolvedPDFJS()) as unknown as { OPS: Record<string, number> };
	const pdf = await getDocumentProxy(new Uint8Array(bytes.slice(0)));
	try {
		const out: Chip[] = [];
		for (const n of pages) {
			if (n < 1 || n > pdf.numPages) continue;
			const page = await pdf.getPage(n);
			const ops = (await page.getOperatorList()) as unknown as OperatorList;
			const images = new Map<string, { hex: string; uniform: boolean }>();
			if (ops.fnArray.includes(pdfjs.OPS.paintImageXObject)) {
				for (const img of await extractImages(pdf, n)) images.set(img.key, representativeColor(img.data, img.width, img.height, img.channels));
			}
			out.push(...chipsFromOperators(n, ops, pdfjs.OPS, images));
			page.cleanup();
		}
		return out;
	} finally {
		await pdf.cleanup();
	}
}

export interface ColorTarget {
	key: string;
	name: string;
	page: number;
}

/**
 * Pair each colour with the nearest unused chip next to where its name is printed.
 * Falls back to reading order only when the counts on a page match exactly.
 */
export function matchChips(colors: ColorTarget[], chips: Chip[], items: Map<number, TextItem[]>): Map<string, Chip> {
	const result = new Map<string, Chip>();
	const used = new Set<Chip>();
	const pairs: { key: string; chip: Chip; d: number }[] = [];

	for (const c of colors) {
		const name = compact(c.name);
		if (!name) continue;
		const labels = [c.page, c.page - 1, c.page + 1].flatMap((p) => (items.get(p) ?? []).map((it) => ({ p, it })));
		for (const { p, it } of labels) {
			const text = compact(it.str);
			if (!(text.length >= 2 && (text.includes(name) || name.includes(text)))) continue;
			const lx = it.x + it.w / 2;
			const ly = it.y + it.h / 2;
			for (const chip of chips) {
				if (chip.page !== p) continue;
				const d = Math.hypot(chip.x + chip.w / 2 - lx, chip.y + chip.h / 2 - ly);
				if (d <= Math.max(90, 3 * Math.max(chip.w, chip.h))) pairs.push({ key: c.key, chip, d });
			}
		}
	}
	for (const { key, chip } of pairs.sort((a, b) => a.d - b.d)) {
		if (result.has(key) || used.has(chip)) continue;
		result.set(key, chip);
		used.add(chip);
	}

	// Reading-order fallback per page (top-to-bottom, left-to-right), only on an exact count match.
	const byPage = new Map<number, ColorTarget[]>();
	for (const c of colors) if (!result.has(c.key)) byPage.set(c.page, [...(byPage.get(c.page) ?? []), c]);
	for (const [page, left] of byPage) {
		const free = chips
			.filter((ch) => ch.page === page && !used.has(ch))
			.sort((a, b) => (Math.abs(b.y - a.y) > Math.min(a.h, b.h) / 2 ? b.y - a.y : a.x - b.x));
		if (free.length !== left.length) continue;
		// Distinct paints have distinct colours; identical chips are icons or decoration.
		if (new Set(free.map((ch) => ch.hex)).size !== free.length) continue;
		left.forEach((c, i) => (result.set(c.key, free[i]), used.add(free[i])));
	}
	return result;
}

/** Relative lightness 0–1 (HSL L). */
export function lightness(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
	return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

/**
 * Rejects matches that contradict the colour's name: a "white" that came out dark or a "black"
 * that came out light means the chip belongs to something else. Two-tone names are not checked.
 */
export function plausible(name: string, hex: string): boolean {
	const n = name.normalize('NFKC').toLowerCase();
	if (/[/·]|투톤/.test(n)) return true;
	const l = lightness(hex);
	if (/화이트|white|흰/.test(n)) return l >= 0.7;
	if (/블랙|black|검정/.test(n)) return l <= 0.3;
	return true;
}

/**
 * Fill exterior colour hexes from PDF chips (both passes, matched by colour key). Colours without a
 * chip keep a model estimate (OpenAI fallback only) or stay empty. Returns how many came from the PDF.
 *
 * Interior colours are skipped: real price sheets (Hyundai/Kia/Genesis, 2026-11) show interiors as
 * seat photos and fabric close-ups, whose median colour was wrong more often than right.
 */
export async function enrichHexes(bytes: ArrayBuffer, extractions: Extraction[], colorPages: number[]): Promise<{ fromPdf: number; chips: number }> {
	const colors = extractions.flatMap((e) => e.colors).filter((c) => c.kind === 'exterior');
	if (colors.length === 0) return { fromPdf: 0, chips: 0 };
	const pages = [...new Set([...colorPages, ...colors.map((c) => c.evidence.page)])].sort((a, b) => a - b);
	const chips = await findChips(bytes, pages);
	const items = new Map((await extractPages(bytes)).map((p) => [p.page, p.items]));
	const seen = new Map<string, ColorTarget>();
	for (const c of colors) {
		const key = itemKey.color(c);
		if (!seen.has(key)) seen.set(key, { key, name: c.name, page: c.evidence.page });
	}
	const matched = matchChips([...seen.values()], chips, items);
	for (const t of seen.values()) {
		const chip = matched.get(t.key);
		if (chip && !plausible(t.name, chip.hex)) matched.delete(t.key);
	}
	for (const c of colors) {
		const chip = matched.get(itemKey.color(c));
		if (chip) {
			c.hex = chip.hex;
			c.hexSource = 'pdf';
		} else if (c.hex) c.hexSource = 'model';
	}
	return { fromPdf: matched.size, chips: chips.length };
}
