// Turn a reconcile result into sheet rows and write it (PLAN.md §7.8).
import type { Brand, ReviewReason, SheetName } from '@shared/types';
import { familyName } from '../pipeline/identity.ts';
import type { ReconcileResult, ReconciledItem } from '../pipeline/reconcile.ts';
import { itemLabel, summarize } from '../pipeline/reconcile.ts';
import type { ColorItem, OptionItem, RuleItem, TrimItem } from '../pipeline/schema.ts';
import { newId } from '../shared/ids.ts';
import { kstNow } from '../shared/time.ts';
import { BRAND_LABEL, COLOR_KIND_LABEL, REASON_LABEL, RULE_TYPE_LABEL, SHEET_LABEL, TABS, type TabSpec } from './layout.ts';
import type { Cell, SheetsPort } from './port.ts';
import type { SheetsRepo } from './repo.ts';
import { toCells, toRecords } from './rows.ts';

/** Item id of the per-job "check approximate hexes" review row. */
export const hexSummaryId = (jobId: string) => `hexsum_${jobId}`;

export interface JobVehicle {
	jobId: string;
	brand: Brand | null;
	vehicleName: string;
	modelYear: string;
}

export const HEX_SOURCE_LABEL = { pdf: 'PDF 칩', model: 'OpenAI 추정', user: '사용자 수정' } as const;

const ITEM_TAB: Record<SheetName, TabSpec> = { trim: TABS.trim, color: TABS.color, option: TABS.option, rule: TABS.rule };

export const reasonsText = (reasons: readonly ReviewReason[]) =>
	reasons.map((r) => (r.detail ? `${REASON_LABEL[r.code]}(${r.detail})` : REASON_LABEL[r.code])).join('; ');

/** Comparable identity of a data row: brand label + family name + model year. */
const rowVehicle = (brand: string, vehicleName: string, modelYear: string) => `${brand}|${familyName(vehicleName) ?? vehicleName}|${modelYear}`;

function itemCells(it: ReconciledItem, head: Record<string, Cell>): Record<string, Cell> {
	const base = {
		...head,
		evidencePage: it.final.evidence.page,
		evidenceQuote: it.final.evidence.quote,
		status: it.status,
		reviewReasons: reasonsText(it.reasons),
	};
	switch (it.sheet) {
		case 'trim': {
			const t = it.final as TrimItem;
			return { ...base, name: t.name, price: t.price, priceNote: t.priceNote ?? '', powertrain: t.powertrain ?? '' };
		}
		case 'color': {
			const c = it.final as ColorItem;
			return {
				...base,
				kind: COLOR_KIND_LABEL[c.kind],
				name: c.name,
				code: c.code ?? '',
				hex: c.hex ?? '',
				preview: '',
				hexSource: c.hex ? HEX_SOURCE_LABEL[c.hexSource ?? 'model'] : '',
				applicableTrims: c.applicableTrims.includes('*') ? '전 트림' : c.applicableTrims.join(', '),
			};
		}
		case 'option': {
			const o = it.final as OptionItem;
			return {
				...base,
				name: o.name,
				price: o.price,
				applicableTrims: o.applicableTrims.includes('*') ? '전 트림' : o.applicableTrims.join(', '),
				includes: o.includes.join(', '),
			};
		}
		case 'rule': {
			const r = it.final as RuleItem;
			return {
				...base,
				type: RULE_TYPE_LABEL[r.type],
				subject: r.subject,
				targets: r.targets.join(', '),
				condition: r.condition,
				result: r.result,
				footnoteText: r.evidence.footnote ? `[${r.evidence.footnote}] ${r.footnoteText}` : r.footnoteText,
			};
		}
	}
}

export interface WriteSummary {
	written: Record<SheetName, number>;
	review: number;
	replacedRows: number;
}

/**
 * Replace any earlier result of the same vehicle (brand + family + year) with this job's rows:
 * delete old rows, append one batch per tab, paint colour previews.
 */
export async function writeJobResult(repo: SheetsRepo, vehicle: JobVehicle, result: ReconcileResult): Promise<WriteSummary> {
	await repo.ensureLayout();
	const port: SheetsPort = repo.port;
	const brand = vehicle.brand ? BRAND_LABEL[vehicle.brand] : '';
	const updatedAt = kstNow();
	const head = { jobId: vehicle.jobId, brand, vehicleName: vehicle.vehicleName, modelYear: vehicle.modelYear, updatedAt };
	const target = rowVehicle(brand, vehicle.vehicleName, vehicle.modelYear);

	// 1. Delete earlier rows of this vehicle from the data tabs and the review tab.
	const tabs = [...Object.values(ITEM_TAB), TABS.review as TabSpec];
	const before = await port.readTabs(tabs.map((t) => t.title));
	let replacedRows = 0;
	const oldJobIds = new Set<string>();
	for (const spec of Object.values(ITEM_TAB)) {
		const stale = toRecords(spec, before[spec.title] ?? []).filter(
			(r) => r.values.jobId !== vehicle.jobId && rowVehicle(r.values.brand, r.values.vehicleName, r.values.modelYear) === target,
		);
		stale.forEach((r) => oldJobIds.add(r.values.jobId));
		replacedRows += stale.length;
		await port.deleteRows(spec.title, stale.map((r) => r.row));
	}
	const staleReview = toRecords(TABS.review, before[TABS.review.title] ?? []).filter(
		(r) => oldJobIds.has(r.values.jobId) || r.values.jobId === vehicle.jobId,
	);
	await port.deleteRows(TABS.review.title, staleReview.map((r) => r.row));

	// 2. Append this job's rows, one call per tab.
	const ids = new Map<ReconciledItem, string>();
	const written = { trim: 0, color: 0, option: 0, rule: 0 } as Record<SheetName, number>;
	for (const sheet of Object.keys(ITEM_TAB) as SheetName[]) {
		const items = result.items.filter((i) => i.sheet === sheet);
		const rows = items.map((it) => {
			const itemId = newId('itm');
			ids.set(it, itemId);
			return toCells(ITEM_TAB[sheet], itemCells(it, { ...head, itemId }));
		});
		await port.append(ITEM_TAB[sheet].title, rows);
		written[sheet] = rows.length;
	}

	const reviewItems = result.items.filter((i) => i.status === '확인 필요');
	await port.append(
		TABS.review.title,
		reviewItems.map((it) =>
			toCells(TABS.review, {
				itemId: ids.get(it),
				jobId: vehicle.jobId,
				vehicleName: vehicle.vehicleName,
				sheet: SHEET_LABEL[it.sheet],
				label: itemLabel(it.sheet, it.final),
				reasons: reasonsText(it.reasons.filter((r) => r.code !== 'FALLBACK_MODEL' && r.code !== 'HEX_APPROX')),
				passA: summarize(it.sheet, it.passA),
				passB: summarize(it.sheet, it.passB),
				evidencePage: it.final.evidence.page,
				evidenceQuote: it.final.evidence.quote,
				progress: '대기',
			}),
		),
	);

	// One summary row asking the reviewer to eyeball the approximate hexes (PLAN.md §7.10).
	const hexCount = result.items.filter((i) => i.sheet === 'color' && (i.final as ColorItem).hex).length;
	if (hexCount > 0) {
		await port.append(TABS.review.title, [
			toCells(TABS.review, {
				itemId: hexSummaryId(vehicle.jobId),
				jobId: vehicle.jobId,
				vehicleName: vehicle.vehicleName,
				sheet: SHEET_LABEL.color,
				label: `헥사코드 근사값 ${hexCount}개`,
				reasons: '헥사코드 근사값 — 색상 탭의 미리보기를 PDF 색상과 비교해 주세요',
				passA: '',
				passB: '',
				evidencePage: '',
				evidenceQuote: '',
				progress: '대기',
			}),
		]);
	}

	// 3. Paint colour previews (needs the row numbers the append produced).
	const hexItems = result.items.filter((i) => i.sheet === 'color' && (i.final as ColorItem).hex);
	if (hexItems.length) {
		const after = toRecords(TABS.color, (await port.readTabs([TABS.color.title]))[TABS.color.title] ?? []);
		const previewCol = TABS.color.columns.findIndex((c) => c.key === 'preview') + 1;
		const cells = hexItems.flatMap((it) => {
			const rec = after.find((r) => r.values.itemId === ids.get(it));
			const hex = (it.final as ColorItem).hex!;
			return rec && /^#[0-9a-f]{6}$/i.test(hex) ? [{ row: rec.row, col: previewCol, hex }] : [];
		});
		await port.setBackgrounds(TABS.color.title, cells);
	}

	return { written, review: reviewItems.length, replacedRows };
}
