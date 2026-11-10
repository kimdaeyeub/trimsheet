// Duplicate / model-year / collection-policy decisions (PLAN.md §7.11 (3)). Pure function.
import type { DedupAction } from '@shared/types';

export type VehicleStatus = '처리 완료' | '처리 중' | '기준선' | '갱신 후보' | '보류' | '이전 연식';

export interface RegisteredVehicle {
	vehicleKey: string;
	familyKey: string;
	modelYear: string;
	effectiveDate: string;
	status: VehicleStatus | string;
	sha256: string;
	lastJobId: string;
}

export interface Candidate {
	familyKey: string | null;
	vehicleKey: string | null;
	modelYear: string | null;
	effectiveDate: string | null;
	sha256: string | null;
	/** The user explicitly asked to (re)process. */
	force?: boolean;
	/** First scan: register as baseline only. */
	baselineMode?: boolean;
}

export type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R4b' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'R11' | 'NAME' | 'BASE';

export interface Decision {
	action: DedupAction;
	rule: RuleId;
	reason: string;
	existingJobId?: string;
}

export interface DedupPolicy {
	maxPriceSheetAgeDays: number;
	sameYearNewerPriceSheet: 'update_candidate' | 'process' | 'skip';
}

const daysBetween = (isoDate: string, now: Date) => (now.getTime() - new Date(`${isoDate}T00:00:00+09:00`).getTime()) / 86_400_000;

export function decide(c: Candidate, registry: readonly RegisteredVehicle[], policy: DedupPolicy, now: Date = new Date()): Decision {
	const same = c.vehicleKey ? registry.find((r) => r.vehicleKey === c.vehicleKey) : undefined;

	// Never overridden by `force`.
	if (same?.status === '처리 중') return { action: 'skip', rule: 'R5', reason: '이미 처리 중', existingJobId: same.lastJobId || undefined };
	// R1 looks at every vehicle, not just this key: an inferred model year (no "20XX년형" in the PDF)
	// can differ for the same file seen in a later year.
	const sameFile = c.sha256 ? registry.find((r) => r.sha256 === c.sha256 && r.status === '처리 완료') : undefined;
	if (sameFile) {
		return { action: 'skip', rule: 'R1', reason: '이미 정리된 가격표(같은 파일)', existingJobId: sameFile.lastJobId || undefined };
	}

	if (c.force) return { action: 'process', rule: 'R11', reason: '사용자 요청으로 다시 정리' };

	if (!c.familyKey) return { action: 'hold', rule: 'NAME', reason: '차종을 확인할 수 없음 — 사용자 확인 필요' };
	if (!c.modelYear) return { action: 'hold', rule: 'R9', reason: '연식 불명 — 사용자 확인 필요' };

	const family = registry.filter((r) => r.familyKey === c.familyKey && r.status !== '이전 연식');
	const newest = family.reduce<RegisteredVehicle | null>((a, r) => (!a || r.modelYear > a.modelYear ? r : a), null);
	if (newest && newest.modelYear > c.modelYear) {
		return { action: 'skip', rule: 'R2', reason: `이전 연식 (최신: ${newest.modelYear}년형)`, existingJobId: newest.lastJobId || undefined };
	}

	if (c.effectiveDate && daysBetween(c.effectiveDate, now) > policy.maxPriceSheetAgeDays) {
		return { action: 'hold', rule: 'R10', reason: `오래된 가격표 (기준일 ${c.effectiveDate})` };
	}

	if (same) {
		const newerDate = c.effectiveDate && same.effectiveDate ? c.effectiveDate > same.effectiveDate : null;

		if (same.status === '처리 완료') {
			if (newerDate === null) return { action: 'hold', rule: 'R4b', reason: '같은 연식의 다른 가격표 — 기준일을 비교할 수 없음', existingJobId: same.lastJobId || undefined };
			if (!newerDate) return { action: 'skip', rule: 'R3', reason: '이미 정리된 차량(같은 연식)', existingJobId: same.lastJobId || undefined };
			const action = policy.sameYearNewerPriceSheet;
			const reason =
				action === 'process' ? `같은 연식의 새 가격표 — 자동 갱신 (기준일 ${same.effectiveDate} → ${c.effectiveDate})` : action === 'skip' ? '같은 연식의 새 가격표 — 정책상 무시' : '같은 연식의 새 가격표 — 갱신 후보';
			return { action, rule: 'R4', reason, existingJobId: same.lastJobId || undefined };
		}

		if (same.status === '기준선') {
			if (c.sha256 && same.sha256 === c.sha256) return { action: 'skip', rule: 'BASE', reason: '기준선으로 등록된 차량 — 수집 현황에서 처리할 수 있음' };
			return { action: 'baseline', rule: 'BASE', reason: '기준선 차량의 새 가격표 — 기준선만 갱신' };
		}

		// 보류 / 갱신 후보: the same file stays where it is; a different file is re-evaluated as new below.
		if (c.sha256 && same.sha256 === c.sha256) return { action: 'skip', rule: 'R3', reason: `이미 ${same.status} 상태` };
	}

	if (c.baselineMode) return { action: 'baseline', rule: 'R7', reason: '최초 기준선 — 처리하지 않음' };
	if (newest) return { action: 'process', rule: 'R6', reason: `신규 연식 (${newest.modelYear} → ${c.modelYear})` };
	return { action: 'process', rule: 'R8', reason: '신차' };
}

/**
 * Scan-level safety cap: when more than `max` items would be processed automatically,
 * process none and hold them all (also catches site changes that make everything look new).
 */
export function applyScanCap<T extends { decision: Decision }>(items: T[], max: number): { items: T[]; capped: boolean } {
	const toProcess = items.filter((i) => i.decision.action === 'process');
	if (toProcess.length <= max) return { items, capped: false };
	return {
		capped: true,
		items: items.map((i) =>
			i.decision.action === 'process'
				? { ...i, decision: { ...i.decision, action: 'hold' as const, reason: `${i.decision.reason} — 한 번에 너무 많아(${toProcess.length}건) 자동 처리 보류` } }
				: i,
		),
	};
}

/** Among several PDFs of one family (e.g. one vehicle page), keep only the latest model year. */
export function keepLatestPerFamily<T extends { familyKey: string | null; modelYear: string | null }>(
	items: T[],
): { kept: T[]; dropped: { item: T; reason: string }[] } {
	const latest = new Map<string, string>();
	for (const i of items) {
		if (!i.familyKey || !i.modelYear) continue;
		const cur = latest.get(i.familyKey);
		if (!cur || i.modelYear > cur) latest.set(i.familyKey, i.modelYear);
	}
	const kept: T[] = [];
	const dropped: { item: T; reason: string }[] = [];
	for (const i of items) {
		const top = i.familyKey ? latest.get(i.familyKey) : undefined;
		if (top && i.modelYear && i.modelYear < top) dropped.push({ item: i, reason: `이전 연식 (최신: ${top}년형)` });
		else kept.push(i);
	}
	return { kept, dropped };
}
