import type { TabSpec } from './layout.ts';
import { headersOf } from './layout.ts';
import { cellToString, type Cell, type SheetsPort, type TabInfo } from './port.ts';

interface MemoryTab {
	sheetId: number;
	hidden: boolean;
	rows: string[][];
	backgrounds: Map<string, string>;
}

/** In-memory spreadsheet with the same contract as the Google implementation. */
export class MemorySheetsPort implements SheetsPort {
	readonly kind = 'memory' as const;
	readonly tabs = new Map<string, MemoryTab>();
	private nextSheetId = 1;

	spreadsheetUrl(): string | null {
		return null;
	}

	async listTabs(): Promise<TabInfo[]> {
		return [...this.tabs].map(([title, t]) => ({ title, sheetId: t.sheetId }));
	}

	async addTabs(specs: readonly TabSpec[]): Promise<void> {
		for (const spec of specs) {
			if (this.tabs.has(spec.title)) continue;
			this.tabs.set(spec.title, {
				sheetId: this.nextSheetId++,
				hidden: Boolean(spec.hidden),
				rows: [headersOf(spec)],
				backgrounds: new Map(),
			});
		}
	}

	async readTabs(titles: readonly string[]): Promise<Record<string, string[][]>> {
		const out: Record<string, string[][]> = {};
		for (const title of titles) out[title] = (this.tabs.get(title)?.rows ?? []).map((r) => [...r]);
		return out;
	}

	async append(title: string, rows: Cell[][]): Promise<void> {
		this.tab(title).rows.push(...rows.map((r) => r.map(cellToString)));
	}

	async updateRows(updates: { title: string; row: number; values: Cell[] }[]): Promise<void> {
		for (const u of updates) this.tab(u.title).rows[u.row - 1] = u.values.map(cellToString);
	}

	async deleteRows(title: string, rows: number[]): Promise<void> {
		const tab = this.tab(title);
		for (const row of [...new Set(rows)].sort((a, b) => b - a)) tab.rows.splice(row - 1, 1);
	}

	async setBackgrounds(title: string, cells: { row: number; col: number; hex: string }[]): Promise<void> {
		const tab = this.tab(title);
		for (const c of cells) tab.backgrounds.set(`${c.row}:${c.col}`, c.hex);
	}

	private tab(title: string): MemoryTab {
		const tab = this.tabs.get(title);
		if (!tab) throw new Error(`memory sheet: no tab "${title}"`);
		return tab;
	}
}
