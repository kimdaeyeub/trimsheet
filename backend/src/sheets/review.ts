// Reviewer actions on extracted items (PLAN.md §5, Phase 4.8). The sheet stays the source of truth.
import type { ItemAction, ItemActionResponse, SheetName } from '@shared/types';
import { parsePrice } from '../pipeline/normalize.ts';
import { AppError } from '../shared/errors.ts';
import { kstNow } from '../shared/time.ts';
import { COLOR_KIND_LABEL, RULE_TYPE_LABEL, TABS, type TabSpec } from './layout.ts';
import type { Cell } from './port.ts';
import type { SheetsRepo } from './repo.ts';
import { hexSummaryId } from './result.ts';
import { toCells, toRecords, type SheetRecord } from './rows.ts';

const ITEM_TABS: Record<SheetName, TabSpec> = { trim: TABS.trim, color: TABS.color, option: TABS.option, rule: TABS.rule };

/** Columns a reviewer may edit, per sheet. Everything else (ids, evidence, vehicle) is fixed. */
export const EDITABLE: Record<SheetName, readonly string[]> = {
	trim: ['name', 'price', 'priceNote', 'powertrain'],
	color: ['kind', 'name', 'code', 'hex', 'applicableTrims'],
	option: ['name', 'price', 'applicableTrims', 'includes'],
	rule: ['type', 'subject', 'targets', 'condition', 'result', 'footnoteText'],
};

const KIND_VALUES: readonly string[] = Object.values(COLOR_KIND_LABEL);
const RULE_VALUES: readonly string[] = Object.values(RULE_TYPE_LABEL);

/** Validate and coerce one edited value. Returns the cell to write. */
function coerce(sheet: SheetName, key: string, raw: string): Cell {
	const value = raw.trim();
	if (key === 'price') {
		if (value === '') return '';
		const n = parsePrice(value);
		if (n === null || n < 0 || n >= 300_000_000) throw new AppError('invalid_input', `가격을 숫자로 입력하세요: "${raw}"`);
		return n;
	}
	if (key === 'hex' && value && !/^#[0-9a-f]{6}$/i.test(value)) throw new AppError('invalid_input', '헥사코드는 #RRGGBB 형식이어야 합니다.');
	if (key === 'kind' && !KIND_VALUES.includes(value)) throw new AppError('invalid_input', `구분은 ${KIND_VALUES.join(' / ')} 중 하나여야 합니다.`);
	if (key === 'type' && !RULE_VALUES.includes(value)) throw new AppError('invalid_input', `유형은 ${RULE_VALUES.join(' / ')} 중 하나여야 합니다.`);
	if (key === 'name' && !value) throw new AppError('invalid_input', '이름은 비워 둘 수 없습니다.');
	if (sheet === 'rule' && key === 'subject' && !value) throw new AppError('invalid_input', '대상 옵션은 비워 둘 수 없습니다.');
	return value;
}

async function findItem(repo: SheetsRepo, jobId: string, itemId: string): Promise<{ sheet: SheetName; spec: TabSpec; rec: SheetRecord }> {
	await repo.ensureLayout();
	const sheets = Object.keys(ITEM_TABS) as SheetName[];
	const raw = await repo.port.readTabs(sheets.map((s) => ITEM_TABS[s].title));
	for (const sheet of sheets) {
		const spec = ITEM_TABS[sheet];
		const rec = toRecords(spec, raw[spec.title] ?? []).find((r) => r.values.itemId === itemId);
		if (rec) {
			if (rec.values.jobId !== jobId) throw new AppError('not_found', '이 작업의 항목이 아닙니다.', 404);
			return { sheet, spec, rec };
		}
	}
	throw new AppError('not_found', '항목을 찾을 수 없습니다. 시트에서 지워졌거나 다른 결과로 교체되었을 수 있습니다.', 404);
}

/** Mark the matching 확인필요 row as 완료 (no-op when the item was never under review). */
async function closeReviewRow(repo: SheetsRepo, itemIds: string[]): Promise<void> {
	if (itemIds.length === 0) return;
	const spec = TABS.review as TabSpec;
	const raw = await repo.port.readTabs([spec.title]);
	const ids = new Set(itemIds);
	const rows = toRecords(spec, raw[spec.title] ?? []).filter((r) => ids.has(r.values.itemId) && r.values.progress !== '완료');
	await repo.port.updateRows(rows.map((r) => ({ title: spec.title, row: r.row, values: toCells(spec, { ...r.values, progress: '완료' }) })));
}

export async function applyItemAction(
	repo: SheetsRepo,
	jobId: string,
	itemId: string,
	input: ItemAction,
): Promise<ItemActionResponse> {
	// The "approximate hexes" summary row has no data row behind it: approving just closes it.
	if (itemId === hexSummaryId(jobId)) {
		if (input.action !== 'approve') throw new AppError('invalid_input', '헥사코드 확인 행은 승인만 할 수 있습니다. 개별 색상은 색상 탭에서 수정하세요.');
		await repo.ensureLayout();
		await closeReviewRow(repo, [itemId]);
		return { itemId, sheet: 'color', status: '승인', values: {} };
	}
	const { sheet, spec, rec } = await findItem(repo, jobId, itemId);
	const patch: Record<string, Cell> = { updatedAt: kstNow() };

	if (input.action === 'approve') patch.status = '승인';
	else if (input.action === 'reject') patch.status = '제외';
	else {
		const allowed = EDITABLE[sheet];
		const unknown = Object.keys(input.data).filter((k) => !allowed.includes(k));
		if (unknown.length) throw new AppError('invalid_input', `수정할 수 없는 항목입니다: ${unknown.join(', ')}`);
		for (const [k, v] of Object.entries(input.data)) patch[k] = coerce(sheet, k, v);
		if (sheet === 'color' && 'hex' in input.data) patch.hexSource = input.data.hex ? '사용자 수정' : '';
		patch.status = '수정됨';
	}

	await repo.port.updateRows([{ title: spec.title, row: rec.row, values: toCells(spec, { ...rec.values, ...patch }) }]);
	if (sheet === 'color' && typeof patch.hex === 'string' && patch.hex) {
		const col = spec.columns.findIndex((c) => c.key === 'preview') + 1;
		await repo.port.setBackgrounds(spec.title, [{ row: rec.row, col, hex: patch.hex }]);
	}
	await closeReviewRow(repo, [itemId]);

	const values = Object.fromEntries(Object.entries({ ...rec.values, ...patch }).map(([k, v]) => [k, v === null ? '' : String(v)]));
	return { itemId, sheet, status: String(patch.status), values };
}

/** Approve every 자동 확정 item of a job in one batch. */
export async function approveAllAuto(repo: SheetsRepo, jobId: string): Promise<number> {
	await repo.ensureLayout();
	const sheets = Object.keys(ITEM_TABS) as SheetName[];
	const raw = await repo.port.readTabs(sheets.map((s) => ITEM_TABS[s].title));
	const now = kstNow();
	const updates = sheets.flatMap((sheet) => {
		const spec = ITEM_TABS[sheet];
		return toRecords(spec, raw[spec.title] ?? [])
			.filter((r) => r.values.jobId === jobId && r.values.status === '자동 확정')
			.map((r) => ({ title: spec.title, row: r.row, values: toCells(spec, { ...r.values, status: '승인', updatedAt: now }) }));
	});
	await repo.port.updateRows(updates);
	return updates.length;
}
