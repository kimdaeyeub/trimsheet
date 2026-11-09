import type { TabSpec } from './layout.ts';
import type { Cell } from './port.ts';

export interface SheetRecord {
	/** 1-based sheet row number (header is row 1). */
	row: number;
	values: Record<string, string>;
}

/**
 * Maps raw rows to records keyed by column `key`, locating columns by their Korean
 * header text so a user re-ordering columns in the sheet does not corrupt data.
 */
export function toRecords(spec: TabSpec, rows: string[][]): SheetRecord[] {
	if (rows.length === 0) return [];
	const header = rows[0];
	const index = new Map(spec.columns.map((col) => [col.key, header.indexOf(col.header)] as const));
	const out: SheetRecord[] = [];
	for (let i = 1; i < rows.length; i++) {
		const raw = rows[i];
		if (!raw || raw.every((v) => v === '')) continue;
		const values: Record<string, string> = {};
		for (const [key, idx] of index) values[key] = idx >= 0 ? (raw[idx] ?? '') : '';
		out.push({ row: i + 1, values });
	}
	return out;
}

/** Object → row cells in the tab's column order. Missing keys become empty cells. */
export function toCells(spec: TabSpec, obj: Record<string, Cell | undefined>): Cell[] {
	return spec.columns.map((col) => obj[col.key] ?? '');
}

export function findByKey(records: SheetRecord[], key: string, value: string): SheetRecord | undefined {
	return records.find((r) => r.values[key] === value);
}
