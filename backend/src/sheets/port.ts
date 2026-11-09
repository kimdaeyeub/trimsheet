import type { TabSpec } from './layout.ts';

export type Cell = string | number | boolean | null;

export interface TabInfo {
	title: string;
	sheetId: number;
}

/**
 * The minimal spreadsheet surface the app needs.
 * `GoogleSheetsPort` talks to the Sheets API; `MemorySheetsPort` backs tests and
 * local development before Google Sheets is configured.
 * Row numbers are 1-based like the Sheets UI (row 1 = header).
 */
export interface SheetsPort {
	readonly kind: 'google' | 'memory';
	spreadsheetUrl(): string | null;
	listTabs(): Promise<TabInfo[]>;
	/** Create tabs with header row, header style, number formats, dropdowns, hidden flag. */
	addTabs(specs: readonly TabSpec[]): Promise<void>;
	/** All rows of each tab, header included, cells as strings. */
	readTabs(titles: readonly string[]): Promise<Record<string, string[][]>>;
	append(title: string, rows: Cell[][]): Promise<void>;
	updateRows(updates: { title: string; row: number; values: Cell[] }[]): Promise<void>;
	deleteRows(title: string, rows: number[]): Promise<void>;
	setBackgrounds(title: string, cells: { row: number; col: number; hex: string }[]): Promise<void>;
}

export function cellToString(cell: unknown): string {
	if (cell === null || cell === undefined) return '';
	if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE';
	return String(cell);
}

/** 1 → A, 27 → AA */
export function columnLetter(index1: number): string {
	let n = index1;
	let out = '';
	while (n > 0) {
		const rem = (n - 1) % 26;
		out = String.fromCharCode(65 + rem) + out;
		n = Math.floor((n - 1) / 26);
	}
	return out;
}

/** Quote a tab title for A1 notation: 'PDF목록'!A1 */
export const a1 = (title: string, range = '') => `'${title.replaceAll("'", "''")}'${range ? `!${range}` : ''}`;
