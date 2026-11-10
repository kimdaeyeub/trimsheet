import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { chipSized, findChips, matchChips, representativeColor } from '../src/pipeline/hex.ts';
import { extractPages } from '../src/pipeline/pdf-text.ts';
import { makePng } from './helpers/png.ts';

/** A colour page: two vector swatches, one glossy raster swatch, a photo, a table bar and a page background. */
async function colorPage(): Promise<ArrayBuffer> {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	doc.addPage([500, 400]).drawText('cover', { x: 40, y: 360, size: 12, font });
	const page = doc.addPage([500, 400]);
	page.drawRectangle({ x: 0, y: 0, width: 500, height: 400, color: rgb(0.97, 0.97, 0.97) }); // background — too big
	page.drawRectangle({ x: 40, y: 330, width: 420, height: 18, color: rgb(0.2, 0.2, 0.6) }); // header bar — too wide
	page.drawText('Exterior colors', { x: 45, y: 334, size: 11, font });

	page.drawRectangle({ x: 40, y: 270, width: 30, height: 20, color: rgb(26 / 255, 26 / 255, 26 / 255) });
	page.drawText('Abyss Black', { x: 78, y: 275, size: 10, font });
	page.drawRectangle({ x: 40, y: 230, width: 30, height: 20, color: rgb(140 / 255, 30 / 255, 30 / 255) });
	page.drawText('Ultimate Red', { x: 78, y: 235, size: 10, font });

	const glossy = await doc.embedPng(makePng(20, 12, (x) => (x === 0 ? [255, 255, 255] : [237 + (x % 3), 235, 228]))); // near-uniform with a highlight edge
	page.drawImage(glossy, { x: 40, y: 190, width: 30, height: 20 });
	page.drawText('Creamy White', { x: 78, y: 195, size: 10, font });

	const photo = await doc.embedPng(makePng(20, 12, (x, y) => [x * 12, y * 20, 255 - x * 12])); // gradient — not a swatch
	page.drawImage(photo, { x: 300, y: 190, width: 30, height: 20 });
	return (await doc.save()).slice().buffer;
}

describe('representativeColor', () => {
	it('returns the median of a solid or glossy swatch and rejects gradients', () => {
		const solid = new Uint8ClampedArray(Array.from({ length: 100 }, () => [10, 20, 30]).flat());
		expect(representativeColor(solid, 10, 10, 3)).toMatchObject({ hex: '#0A141E', uniform: true, share: 1 });
		// Photo-like pixels (wheel photos on the G80 sheet scored 0.07–0.29) are rejected.
		const photo = new Uint8ClampedArray(Array.from({ length: 100 }, (_, i) => [(i * 37) % 256, (i * 91) % 256, (i * 53) % 256]).flat());
		expect(representativeColor(photo, 10, 10, 3).uniform).toBe(false);
		// Metallic paint with highlights (Staria yellow scored 0.34) is accepted.
		const metallic = new Uint8ClampedArray(Array.from({ length: 100 }, (_, i) => (i % 10 < 4 ? [210, 169, 25] : [255, 240 - (i % 10) * 9, 120])).flat());
		expect(representativeColor(metallic, 10, 10, 3)).toMatchObject({ uniform: true });
		expect(representativeColor(new Uint8ClampedArray(Array(16).fill(128)), 4, 4, 1).hex).toBe('#808080');
	});

	it('accepts swatch-sized boxes only', () => {
		expect(chipSized(30, 20)).toBe(true);
		expect(chipSized(420, 18)).toBe(false);
		expect(chipSized(3, 3)).toBe(false);
		expect(chipSized(500, 400)).toBe(false);
	});
});

describe('findChips + matchChips', () => {
	it('finds vector and raster swatches with their positions and colours', async () => {
		const chips = await findChips(await colorPage(), [2]);
		expect(chips.map((c) => [c.source, c.hex, Math.round(c.x), Math.round(c.y)])).toEqual([
			['vector', '#1A1A1A', 40, 270],
			['vector', '#8C1E1E', 40, 230],
			['image', '#EEEBE4', 40, 190],
		]);
	});

	it('pairs each colour with the swatch next to its name', async () => {
		const bytes = await colorPage();
		const chips = await findChips(bytes, [2]);
		const items = new Map((await extractPages(bytes)).map((p) => [p.page, p.items]));
		const colors = [
			{ key: 'w', name: 'Creamy White', page: 2 },
			{ key: 'b', name: 'Abyss Black', page: 2 },
			{ key: 'r', name: 'Ultimate Red', page: 2 },
			{ key: 'x', name: 'Not On Page', page: 2 },
		];
		const m = matchChips(colors, chips, items);
		expect(m.get('b')?.hex).toBe('#1A1A1A');
		expect(m.get('r')?.hex).toBe('#8C1E1E');
		expect(m.get('w')?.hex).toBe('#EEEBE4');
		expect(m.has('x')).toBe(false);
	});

	it('falls back to reading order only when counts match', () => {
		const chip = (y: number, hex: string) => ({ page: 3, x: 10, y, w: 20, h: 20, hex, source: 'vector' as const });
		const chips = [chip(100, '#000002'), chip(200, '#000001')];
		const two = matchChips([{ key: 'a', name: 'A', page: 3 }, { key: 'b', name: 'B', page: 3 }], chips, new Map());
		expect([two.get('a')?.hex, two.get('b')?.hex]).toEqual(['#000001', '#000002']); // top first
		const three = matchChips([{ key: 'a', name: 'A', page: 3 }, { key: 'b', name: 'B', page: 3 }, { key: 'c', name: 'C', page: 3 }], chips, new Map());
		expect(three.size).toBe(0);
	});
});

describe('real-sheet layouts (2026-11 samples)', () => {
	it('accepts wide image strips but keeps vector bars out', () => {
		expect(chipSized(107, 36, 'image')).toBe(true); // Kia
		expect(chipSized(178, 23, 'image')).toBe(true); // Hyundai, clipped
		expect(chipSized(178, 23)).toBe(false); // the same shape as a vector is a table bar
		expect(chipSized(400, 60, 'image')).toBe(false);
	});

	it('rejects matches that contradict the colour name', async () => {
		const { plausible } = await import('../src/pipeline/hex.ts');
		expect(plausible('크리미 화이트', '#EFEEF3')).toBe(true);
		expect(plausible('크리미 화이트', '#002F6C')).toBe(false); // Staria logo icon
		expect(plausible('오로라 블랙 펄', '#949F99')).toBe(false);
		expect(plausible('옵시디언 블랙/세비야 레드 투톤', '#F0F0F0')).toBe(true);
		expect(plausible('세레스 블루', '#2E3A48')).toBe(true);
	});

	it('does not fall back to reading order onto identical chips', () => {
		const chips = [0, 1, 2].map((i) => ({ page: 1, x: 20 + i * 20, y: 700, w: 14, h: 17, hex: '#002F6C', source: 'vector' as const }));
		const colors = ['A', 'B', 'C'].map((n) => ({ key: n, name: `${n}색`, page: 1 }));
		expect(matchChips(colors, chips, new Map()).size).toBe(0);
	});
});
