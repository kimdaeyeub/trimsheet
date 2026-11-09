// Applies the §7.11 decision to a job's vehicle identity using the 차량 registry.
import type { Brand, JobOutcome } from '@shared/types';
import { decide, type Decision, type RegisteredVehicle } from '../pipeline/dedup.ts';
import type { VehicleIdentity } from '../pipeline/identity.ts';
import type { SheetsRepo } from '../sheets/repo.ts';
import { BRAND_LABEL } from '../sheets/layout.ts';
import { SCAN_POLICY } from '../shared/config.ts';

export const brandFromLabel = (label: string | undefined | null): Brand | null =>
	(Object.entries(BRAND_LABEL).find(([, l]) => l === label)?.[0] as Brand | undefined) ?? null;

export async function checkVehicle(
	repo: SheetsRepo,
	id: VehicleIdentity,
	opts: { sha256: string; force: boolean; ownJobId?: string },
): Promise<Decision> {
	const registry: RegisteredVehicle[] = (await repo.listVehicles()).filter((r) => !opts.ownJobId || r.lastJobId !== opts.ownJobId);
	return decide(
		{
			familyKey: id.familyKey,
			vehicleKey: id.vehicleKey,
			modelYear: id.modelYear,
			effectiveDate: id.effectiveDate,
			sha256: opts.sha256,
			force: opts.force,
		},
		registry,
		SCAN_POLICY,
	);
}

/** Same bytes already processed → skip before anything else (R1), even without a vehicle name. */
export async function processedSameFile(repo: SheetsRepo, sha256: string): Promise<Decision | null> {
	const hit = (await repo.listVehicles()).find((r) => r.sha256 === sha256 && r.status === '처리 완료');
	return hit ? { action: 'skip', rule: 'R1', reason: '이미 정리된 가격표(같은 파일)', existingJobId: hit.lastJobId || undefined } : null;
}

export function outcomeFor(d: Decision): JobOutcome {
	if (d.rule === 'R2') return 'older_year';
	if (d.action === 'hold' || d.action === 'update_candidate' || d.action === 'baseline') return 'held';
	return 'duplicate';
}
