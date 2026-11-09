// Read/write functions for every tab. This is the app's "database" layer (PLAN.md §0.5).
import type { Conversation, JobRow, Notification, SheetName } from '@shared/types';
import { AppError } from '../shared/errors.ts';
import { kstNow } from '../shared/time.ts';
import { TAB_LIST, TABS, headersOf, type TabKey, type TabSpec } from './layout.ts';
import type { Cell, SheetsPort } from './port.ts';
import { findByKey, toCells, toRecords, type SheetRecord } from './rows.ts';

const JOB_KEYS = TABS.job.columns.map((col) => col.key) as (keyof JobRow)[];

function toJobRow(values: Record<string, string>): JobRow {
	const row = {} as JobRow;
	for (const key of JOB_KEYS) row[key] = values[key] ?? '';
	return row;
}

const ITEM_TABS: Record<SheetName, TabSpec> = { trim: TABS.trim, color: TABS.color, option: TABS.option, rule: TABS.rule };

// Layout is checked once per spreadsheet per isolate. Not request state: it only remembers
// that a given spreadsheet already has the expected tabs.
const ensuredSpreadsheets = new Set<string>();

export interface VehicleRecord {
	vehicleKey: string;
	familyKey: string;
	brand: string;
	vehicleName: string;
	modelYear: string;
	effectiveDate: string;
	status: string;
	lastJobId: string;
	sourceId: string;
	sha256: string;
	sourceUrl: string;
	reason: string;
	firstSeenAt: string;
	updatedAt: string;
}

const VEHICLE_KEYS = TABS.vehicle.columns.map((col) => col.key) as (keyof VehicleRecord)[];

function toVehicle(values: Record<string, string>): VehicleRecord {
	const row = {} as VehicleRecord;
	for (const key of VEHICLE_KEYS) row[key] = values[key] ?? '';
	return row;
}

export interface PdfSourceInput {
	sourceId: string;
	origin: 'upload' | 'url' | 'crawl';
	filename: string;
	pdfKey: string;
	sha256: string;
	sizeBytes: number;
	pageCount: number | null;
	sourceUrl?: string;
	brand?: string;
	vehicleName?: string;
	modelYear?: string;
	kind?: 'pricesheet' | 'catalog' | 'unknown';
	etag?: string;
	lastModified?: string;
	verdict?: string;
}

export class SheetsRepo {
	constructor(
		readonly port: SheetsPort,
		/** Identity used for the "layout already ensured" memo. */
		private readonly layoutKey: string,
	) {}

	/** Creates missing tabs and verifies headers of existing ones. */
	async ensureLayout(): Promise<void> {
		if (ensuredSpreadsheets.has(this.layoutKey)) return;
		const existing = new Set((await this.port.listTabs()).map((t) => t.title));
		const missing = TAB_LIST.filter((t) => !existing.has(t.title));
		await this.port.addTabs(missing);

		const present = TAB_LIST.filter((t) => existing.has(t.title));
		if (present.length > 0) {
			const data = await this.port.readTabs(present.map((t) => t.title));
			for (const spec of present) {
				const header = data[spec.title]?.[0] ?? [];
				const absent = headersOf(spec).filter((h) => !header.includes(h));
				if (absent.length > 0) {
					throw new AppError(
						'sheet_layout_mismatch',
						`"${spec.title}" 탭에 열이 없습니다: ${absent.join(', ')}. 헤더 행을 고치거나 탭 이름을 바꾼 뒤 다시 시도하세요.`,
						500,
					);
				}
			}
		}
		if (!existing.has(TABS.setting.title)) await this.setSetting('baseline_done', 'FALSE');
		ensuredSpreadsheets.add(this.layoutKey);
	}

	async tabGids(): Promise<Record<string, number>> {
		await this.ensureLayout();
		return Object.fromEntries((await this.port.listTabs()).map((t) => [t.title, t.sheetId]));
	}

	// ---- generic helpers ----------------------------------------------------

	private async read(...keys: TabKey[]): Promise<Record<TabKey, SheetRecord[]>> {
		await this.ensureLayout();
		const specs = keys.map((k) => TABS[k] as TabSpec);
		const raw = await this.port.readTabs(specs.map((s) => s.title));
		return Object.fromEntries(keys.map((k, i) => [k, toRecords(specs[i], raw[specs[i].title] ?? [])])) as Record<
			TabKey,
			SheetRecord[]
		>;
	}

	private async appendOne(key: TabKey, obj: Record<string, Cell | undefined>): Promise<void> {
		await this.ensureLayout();
		const spec = TABS[key] as TabSpec;
		await this.port.append(spec.title, [toCells(spec, obj)]);
	}

	private async updateOne(key: TabKey, record: SheetRecord, patch: Record<string, Cell | undefined>): Promise<void> {
		const spec = TABS[key] as TabSpec;
		await this.port.updateRows([{ title: spec.title, row: record.row, values: toCells(spec, { ...record.values, ...patch }) }]);
	}

	// ---- conversations (_대화) ------------------------------------------------

	async listConversations(): Promise<Conversation[]> {
		const { conversation } = await this.read('conversation');
		return conversation
			.filter((r) => r.values.deleted !== 'TRUE')
			.map((r) => ({ id: r.values.id, title: r.values.title, createdAt: r.values.createdAt, updatedAt: r.values.updatedAt }))
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}

	async createConversation(title: string): Promise<Conversation> {
		const now = kstNow();
		const conv: Conversation = { id: crypto.randomUUID(), title, createdAt: now, updatedAt: now };
		await this.appendOne('conversation', { ...conv, deleted: 'FALSE' });
		return conv;
	}

	async updateConversation(id: string, patch: { title?: string; deleted?: boolean }): Promise<Conversation> {
		const { conversation } = await this.read('conversation');
		const rec = findByKey(conversation, 'id', id);
		if (!rec || rec.values.deleted === 'TRUE') throw new AppError('not_found', '대화를 찾을 수 없습니다.', 404);
		const updatedAt = kstNow();
		await this.updateOne('conversation', rec, {
			...(patch.title !== undefined ? { title: patch.title } : {}),
			...(patch.deleted !== undefined ? { deleted: patch.deleted ? 'TRUE' : 'FALSE' } : {}),
			updatedAt,
		});
		return { id, title: patch.title ?? rec.values.title, createdAt: rec.values.createdAt, updatedAt };
	}

	// ---- PDF sources (PDF목록) ------------------------------------------------

	async findPdfSource(sourceId: string): Promise<Record<string, string> | null> {
		const { pdf } = await this.read('pdf');
		return findByKey(pdf, 'sourceId', sourceId)?.values ?? null;
	}

	async findPdfSourceByUrl(url: string): Promise<Record<string, string> | null> {
		const { pdf } = await this.read('pdf');
		const matches = pdf.filter((r) => r.values.sourceUrl === url);
		return matches.at(-1)?.values ?? null;
	}

	async updatePdfSource(sourceId: string, patch: Partial<Record<keyof PdfSourceInput, Cell>>): Promise<void> {
		const { pdf } = await this.read('pdf');
		const rec = findByKey(pdf, 'sourceId', sourceId);
		if (rec) await this.updateOne('pdf', rec, patch);
	}

	/** Inserts the source if its id is new. Returns true when a row was added. */
	async addPdfSourceIfNew(input: PdfSourceInput): Promise<boolean> {
		if (await this.findPdfSource(input.sourceId)) return false;
		await this.appendOne('pdf', { ...input, fetchedAt: kstNow() });
		return true;
	}

	// ---- jobs (작업) and items ------------------------------------------------

	async listJobs(conversationId?: string): Promise<JobRow[]> {
		const { job } = await this.read('job');
		return job
			.map((r) => toJobRow(r.values))
			.filter((j) => !conversationId || j.conversationId === conversationId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	async getJob(jobId: string): Promise<JobRow | null> {
		const { job } = await this.read('job');
		const rec = findByKey(job, 'jobId', jobId);
		return rec ? toJobRow(rec.values) : null;
	}

	/** Data-tab rows and review rows for one job (one batchGet). */
	async getJobItems(jobId: string): Promise<{ items: Record<SheetName, Record<string, string>[]>; review: Record<string, string>[] }> {
		const data = await this.read('trim', 'color', 'option', 'rule', 'review');
		const pick = (k: TabKey) => data[k].filter((r) => r.values.jobId === jobId).map((r) => r.values);
		const items = Object.fromEntries(
			(Object.keys(ITEM_TABS) as SheetName[]).map((s) => [s, pick(s)]),
		) as Record<SheetName, Record<string, string>[]>;
		return { items, review: pick('review') };
	}

	async createJobRow(row: Partial<JobRow> & { jobId: string }): Promise<void> {
		const now = kstNow();
		await this.appendOne('job', { createdAt: now, updatedAt: now, ...row });
	}

	async updateJobRow(jobId: string, patch: Partial<JobRow>): Promise<void> {
		const { job } = await this.read('job');
		const rec = findByKey(job, 'jobId', jobId);
		if (!rec) throw new AppError('not_found', '작업을 찾을 수 없습니다.', 404);
		await this.updateOne('job', rec, { ...patch, updatedAt: kstNow() });
	}

	// ---- vehicle registry (차량) ------------------------------------------------

	async listVehicles(): Promise<VehicleRecord[]> {
		const { vehicle } = await this.read('vehicle');
		return vehicle.map((r) => toVehicle(r.values));
	}

	/** Insert or update by vehicleKey. */
	async upsertVehicle(v: Partial<VehicleRecord> & { vehicleKey: string }): Promise<void> {
		const { vehicle } = await this.read('vehicle');
		const rec = findByKey(vehicle, 'vehicleKey', v.vehicleKey);
		const now = kstNow();
		if (rec) await this.updateOne('vehicle', rec, { ...v, updatedAt: now });
		else await this.appendOne('vehicle', { firstSeenAt: now, updatedAt: now, ...v });
	}

	/** After a newer model year is processed, mark older years of the family as 이전 연식. */
	async markOlderYears(familyKey: string, modelYear: string): Promise<number> {
		const { vehicle } = await this.read('vehicle');
		const older = vehicle.filter(
			(r) => r.values.familyKey === familyKey && r.values.modelYear < modelYear && r.values.status !== '이전 연식',
		);
		const spec = TABS.vehicle as TabSpec;
		const now = kstNow();
		await this.port.updateRows(
			older.map((r) => ({ title: spec.title, row: r.row, values: toCells(spec, { ...r.values, status: '이전 연식', updatedAt: now }) })),
		);
		return older.length;
	}

	// ---- notifications (_알림) ------------------------------------------------

	async listNotifications(limit = 50): Promise<{ items: Notification[]; unread: number }> {
		const { notification } = await this.read('notification');
		const items = notification
			.map(
				(r): Notification => ({
					id: r.values.id,
					kind: r.values.kind as Notification['kind'],
					title: r.values.title,
					body: r.values.body,
					jobId: r.values.jobId,
					scanRunId: r.values.scanRunId,
					createdAt: r.values.createdAt,
					read: r.values.read === 'TRUE',
				}),
			)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		return { items: items.slice(0, limit), unread: items.filter((n) => !n.read).length };
	}

	async addNotification(n: Omit<Notification, 'createdAt' | 'read'>): Promise<void> {
		await this.appendOne('notification', { ...n, createdAt: kstNow(), read: 'FALSE' });
	}

	async markNotificationRead(id: string): Promise<void> {
		const { notification } = await this.read('notification');
		const rec = findByKey(notification, 'id', id);
		if (!rec) throw new AppError('not_found', '알림을 찾을 수 없습니다.', 404);
		await this.updateOne('notification', rec, { read: 'TRUE' });
	}

	// ---- settings (_설정) ------------------------------------------------------

	async getSetting(key: string): Promise<string | null> {
		const { setting } = await this.read('setting');
		return findByKey(setting, 'key', key)?.values.value ?? null;
	}

	async setSetting(key: string, value: string): Promise<void> {
		const spec = TABS.setting as TabSpec;
		const raw = await this.port.readTabs([spec.title]);
		const rec = findByKey(toRecords(spec, raw[spec.title] ?? []), 'key', key);
		if (rec) await this.updateOne('setting', rec, { value });
		else await this.port.append(spec.title, [toCells(spec, { key, value })]);
	}
}

/** Test hook: forget which spreadsheets were already checked. */
export function resetLayoutMemo(): void {
	ensuredSpreadsheets.clear();
}
