// Vehicle-by-vehicle view of the four data tabs (트림·색상·선택품목·옵션규칙). Pure functions.
import type { CatalogColor, CatalogDetail, CatalogOption, CatalogPage, CatalogRule, CatalogSummary, CatalogTrim, SheetName } from '@shared/types';

type Row = Record<string, string>;
export interface CatalogRows {
	items: Record<SheetName, Row[]>;
	jobs: Row[];
}

export const BRAND_ORDER = ['현대', '기아', '제네시스'];
export const MAX_PAGE_SIZE = 50;

const num = (s: string | undefined) => {
	if (!s) return null;
	const n = Number(s.replaceAll(',', ''));
	return Number.isFinite(n) ? n : null;
};

const visible = (r: Row) => r.status !== '제외';
const vehicleOf = (r: Row) => `${r.brand}\u0000${r.vehicleName}\u0000${r.modelYear}`;

/**
 * One entry per brand + 차종 + 연식. When a vehicle was processed more than once (a newer price
 * sheet for the same year), only the latest job's rows are shown.
 */
export function buildCatalog(rows: CatalogRows): CatalogDetail[] {
	const jobsById = new Map(rows.jobs.map((j) => [j.jobId, j]));
	const all = (Object.keys(rows.items) as SheetName[]).flatMap((s) => rows.items[s].filter(visible).map((r) => ({ s, r })));

	// Latest job per vehicle: job createdAt, else the newest row update.
	const latest = new Map<string, { jobId: string; at: string }>();
	for (const { r } of all) {
		if (!r.jobId) continue;
		const at = jobsById.get(r.jobId)?.createdAt || r.updatedAt || '';
		const k = vehicleOf(r);
		const cur = latest.get(k);
		if (!cur || at > cur.at || (at === cur.at && r.jobId > cur.jobId)) latest.set(k, { jobId: r.jobId, at });
	}

	const out: CatalogDetail[] = [];
	for (const [k, { jobId }] of latest) {
		const mine = all.filter(({ r }) => r.jobId === jobId && vehicleOf(r) === k);
		const of = (s: SheetName) => mine.filter((x) => x.s === s).map((x) => x.r);
		const first = mine[0].r;
		const job = jobsById.get(jobId);

		const trims: CatalogTrim[] = of('trim').map((r) => ({
			name: r.name,
			price: num(r.price),
			priceNote: r.priceNote ?? '',
			powertrain: r.powertrain ?? '',
			page: r.evidencePage ?? '',
			status: r.status ?? '',
		}));
		const colors: CatalogColor[] = of('color').map((r) => ({
			kind: r.kind,
			name: r.name,
			code: r.code ?? '',
			hex: r.hex ?? '',
			applicableTrims: r.applicableTrims ?? '',
			page: r.evidencePage ?? '',
			status: r.status ?? '',
		}));
		const options: CatalogOption[] = of('option').map((r) => ({
			name: r.name,
			price: num(r.price),
			applicableTrims: r.applicableTrims ?? '',
			includes: r.includes ?? '',
			page: r.evidencePage ?? '',
			status: r.status ?? '',
		}));
		const rules: CatalogRule[] = of('rule').map((r) => ({
			type: r.type,
			subject: r.subject,
			targets: r.targets ?? '',
			condition: r.condition ?? '',
			result: r.result ?? '',
			footnote: r.footnoteText ?? '',
			page: r.evidencePage ?? '',
			status: r.status ?? '',
		}));
		const prices = trims.map((t) => t.price).filter((p): p is number => p !== null);
		out.push({
			id: jobId,
			brand: first.brand,
			vehicleName: first.vehicleName,
			modelYear: first.modelYear,
			effectiveDate: job?.effectiveDate ?? '',
			trimCount: trims.length,
			colorCount: colors.length,
			optionCount: options.length,
			ruleCount: rules.length,
			reviewCount: mine.filter(({ r }) => r.status === '확인 필요').length,
			priceFrom: prices.length ? Math.min(...prices) : null,
			priceTo: prices.length ? Math.max(...prices) : null,
			updatedAt: mine.reduce((a, { r }) => (r.updatedAt > a ? r.updatedAt : a), job?.updatedAt ?? ''),
			trims,
			colors,
			options,
			rules,
			pdfUrl: job?.pdfKey?.startsWith('pdf/') ? `/api/files/${job.pdfKey}` : null,
			sourceUrl: job?.sourceUrl || null,
		});
	}

	const brandRank = (b: string) => {
		const i = BRAND_ORDER.indexOf(b);
		return i < 0 ? BRAND_ORDER.length : i;
	};
	return out.sort(
		(a, b) =>
			brandRank(a.brand) - brandRank(b.brand) ||
			a.brand.localeCompare(b.brand, 'ko') ||
			a.vehicleName.localeCompare(b.vehicleName, 'ko') ||
			b.modelYear.localeCompare(a.modelYear),
	);
}

export const toSummary = ({ trims: _t, colors: _c, options: _o, rules: _r, pdfUrl: _p, sourceUrl: _s, ...s }: CatalogDetail): CatalogSummary => s;

export interface PageQuery {
	page?: number;
	pageSize?: number;
	brand?: string;
	q?: string;
}

const compact = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

export function paginate(catalog: readonly CatalogDetail[], query: PageQuery): CatalogPage {
	const brands: Record<string, number> = {};
	for (const v of catalog) brands[v.brand] = (brands[v.brand] ?? 0) + 1;

	const q = query.q ? compact(query.q) : '';
	const filtered = catalog.filter(
		(v) => (!query.brand || v.brand === query.brand) && (!q || compact(`${v.brand}${v.vehicleName}${v.modelYear}`).includes(q)),
	);
	const pageSize = Math.min(Math.max(1, Math.trunc(query.pageSize ?? 12)), MAX_PAGE_SIZE);
	const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
	const page = Math.min(Math.max(1, Math.trunc(query.page ?? 1)), totalPages);
	return {
		items: filtered.slice((page - 1) * pageSize, page * pageSize).map(toSummary),
		page,
		pageSize,
		total: filtered.length,
		totalPages,
		brands,
	};
}
