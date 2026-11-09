import { describe, expect, it } from 'vitest';
import { TABS, headersOf } from '../src/sheets/layout.ts';
import { columnLetter, a1 } from '../src/sheets/port.ts';
import { toCells, toRecords } from '../src/sheets/rows.ts';

describe('rows', () => {
	const spec = TABS.conversation;

	it('maps rows to records by header text, skipping blank rows', () => {
		const rows = [headersOf(spec), ['c1', '첫 작업', 'a', 'b', 'FALSE'], ['', '', '', '', ''], ['c2', '둘째', 'a', 'b', 'TRUE']];
		const records = toRecords(spec, rows);
		expect(records.map((r) => [r.row, r.values.id, r.values.title])).toEqual([
			[2, 'c1', '첫 작업'],
			[4, 'c2', '둘째'],
		]);
	});

	it('survives a user re-ordering columns in the sheet', () => {
		const rows = [['제목', '대화ID', '삭제됨', '생성일', '갱신일'], ['둘째', 'c2', 'FALSE', 'x', 'y']];
		expect(toRecords(spec, rows)[0].values).toMatchObject({ id: 'c2', title: '둘째', deleted: 'FALSE' });
	});

	it('writes cells in column order with blanks for missing keys', () => {
		expect(toCells(spec, { title: 't', id: 'i' })).toEqual(['i', 't', '', '', '']);
	});

	it('builds A1 references', () => {
		expect(columnLetter(1)).toBe('A');
		expect(columnLetter(26)).toBe('Z');
		expect(columnLetter(27)).toBe('AA');
		expect(a1("작업's", 'A1')).toBe("'작업''s'!A1");
	});
});
