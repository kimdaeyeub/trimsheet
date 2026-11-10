import type { TabSpec } from './layout.ts';
import { HEADER_COLOR, headersOf } from './layout.ts';
import { a1, cellToString, columnLetter, type Cell, type SheetsPort, type TabInfo } from './port.ts';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export interface GoogleSheetsOptions {
	spreadsheetId: string;
	getToken: () => Promise<string>;
	fetcher?: typeof fetch;
	/** Retries for 429 / 5xx with exponential backoff. */
	maxRetries?: number;
	sleep?: (ms: number) => Promise<void>;
}

export class SheetsApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = 'SheetsApiError';
	}
}

const hexToRgb = (hex: string) => {
	const n = Number.parseInt(hex.replace('#', ''), 16);
	return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
};

export class GoogleSheetsPort implements SheetsPort {
	readonly kind = 'google' as const;
	private readonly fetcher: typeof fetch;
	private readonly maxRetries: number;
	private readonly sleep: (ms: number) => Promise<void>;
	private tabCache: TabInfo[] | null = null;

	constructor(private readonly opts: GoogleSheetsOptions) {
		this.fetcher = opts.fetcher ?? ((input, init) => fetch(input, init));
		this.maxRetries = opts.maxRetries ?? 3;
		this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
	}

	spreadsheetUrl(): string {
		return `https://docs.google.com/spreadsheets/d/${this.opts.spreadsheetId}/edit`;
	}

	async listTabs(): Promise<TabInfo[]> {
		if (this.tabCache) return this.tabCache;
		const data = await this.call<{ sheets: { properties: { title: string; sheetId: number } }[] }>(
			'GET',
			`?fields=${encodeURIComponent('sheets.properties(title,sheetId)')}`,
		);
		this.tabCache = data.sheets.map((s) => ({ title: s.properties.title, sheetId: s.properties.sheetId }));
		return this.tabCache;
	}

	async addTabs(specs: readonly TabSpec[]): Promise<void> {
		if (specs.length === 0) return;
		const added = await this.call<{ replies: { addSheet: { properties: { sheetId: number; title: string } } }[] }>(
			'POST',
			':batchUpdate',
			{
				requests: specs.map((spec) => ({
					addSheet: {
						properties: { title: spec.title, hidden: Boolean(spec.hidden), gridProperties: { frozenRowCount: 1 } },
					},
				})),
			},
		);
		this.tabCache = null;

		await this.call('POST', '/values:batchUpdate', {
			valueInputOption: 'RAW',
			data: specs.map((spec) => ({ range: a1(spec.title, 'A1'), values: [headersOf(spec)] })),
		});

		const requests: unknown[] = [];
		specs.forEach((spec, i) => {
			const sheetId = added.replies[i].addSheet.properties.sheetId;
			requests.push({
				repeatCell: {
					range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: spec.columns.length },
					cell: {
						userEnteredFormat: {
							backgroundColor: hexToRgb(HEADER_COLOR),
							textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
						},
					},
					fields: 'userEnteredFormat(backgroundColor,textFormat)',
				},
			});
			spec.columns.forEach((col, colIndex) => {
				const range = { sheetId, startRowIndex: 1, startColumnIndex: colIndex, endColumnIndex: colIndex + 1 };
				if (col.number) {
					requests.push({
						repeatCell: {
							range,
							cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' } } },
							fields: 'userEnteredFormat.numberFormat',
						},
					});
				}
				if (col.choices) {
					requests.push({
						setDataValidation: {
							range,
							rule: {
								condition: { type: 'ONE_OF_LIST', values: col.choices.map((v) => ({ userEnteredValue: v })) },
								strict: false,
								showCustomUi: true,
							},
						},
					});
				}
			});
		});
		await this.call('POST', ':batchUpdate', { requests });
	}

	async readTabs(titles: readonly string[]): Promise<Record<string, string[][]>> {
		if (titles.length === 0) return {};
		const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' });
		for (const t of titles) params.append('ranges', a1(t));
		const data = await this.call<{ valueRanges: { values?: unknown[][] }[] }>('GET', `/values:batchGet?${params}`);
		const out: Record<string, string[][]> = {};
		titles.forEach((t, i) => {
			out[t] = (data.valueRanges[i]?.values ?? []).map((row) => row.map(cellToString));
		});
		return out;
	}

	async append(title: string, rows: Cell[][]): Promise<void> {
		if (rows.length === 0) return;
		const params = new URLSearchParams({ valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' });
		await this.call('POST', `/values/${encodeURIComponent(a1(title, 'A1'))}:append?${params}`, { values: rows });
	}

	async updateRows(updates: { title: string; row: number; values: Cell[] }[]): Promise<void> {
		if (updates.length === 0) return;
		await this.call('POST', '/values:batchUpdate', {
			valueInputOption: 'RAW',
			data: updates.map((u) => ({
				range: a1(u.title, `A${u.row}:${columnLetter(u.values.length)}${u.row}`),
				values: [u.values],
			})),
		});
	}

	async deleteRows(title: string, rows: number[]): Promise<void> {
		if (rows.length === 0) return;
		const sheetId = await this.sheetId(title);
		// Delete bottom-up so earlier deletions do not shift later indexes.
		const requests = [...new Set(rows)]
			.sort((a, b) => b - a)
			.map((row) => ({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row } } }));
		await this.call('POST', ':batchUpdate', { requests });
	}

	async setBackgrounds(title: string, cells: { row: number; col: number; hex: string }[]): Promise<void> {
		if (cells.length === 0) return;
		const sheetId = await this.sheetId(title);
		await this.call('POST', ':batchUpdate', {
			requests: cells.map((c) => ({
				repeatCell: {
					range: { sheetId, startRowIndex: c.row - 1, endRowIndex: c.row, startColumnIndex: c.col - 1, endColumnIndex: c.col },
					cell: { userEnteredFormat: { backgroundColor: hexToRgb(c.hex) } },
					fields: 'userEnteredFormat.backgroundColor',
				},
			})),
		});
	}

	private async sheetId(title: string): Promise<number> {
		const tab = (await this.listTabs()).find((t) => t.title === title);
		if (!tab) throw new SheetsApiError(404, `탭 "${title}"이(가) 없습니다.`);
		return tab.sheetId;
	}

	private async call<T = unknown>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
		const url = `${API}/${this.opts.spreadsheetId}${path}`;
		for (let attempt = 0; ; attempt++) {
			const token = await this.opts.getToken();
			const res = await this.fetcher(url, {
				method,
				headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
				body: body ? JSON.stringify(body) : undefined,
			});
			if (res.ok) return (await res.json()) as T;
			const retryable = res.status === 429 || res.status >= 500;
			if (!retryable || attempt >= this.maxRetries) {
				throw new SheetsApiError(res.status, `Sheets API ${method} ${path.split('?')[0]} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
			}
			await res.body?.cancel();
			await this.sleep(500 * 2 ** attempt);
		}
	}
}
