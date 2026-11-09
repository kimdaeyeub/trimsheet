import { describe, expect, it } from 'vitest';
import { MODELS, SCAN_POLICY } from '../src/shared/config.ts';

describe('config', () => {
	it('uses GLM-4.7-Flash on Workers AI for chat and extraction', () => {
		expect(MODELS.chat).toBe('cloudflare/@cf/zai-org/glm-4.7-flash');
		expect(MODELS.extract).toBe('cloudflare/@cf/zai-org/glm-4.7-flash');
	});

	it('keeps the agreed collection policy', () => {
		expect(SCAN_POLICY.initialScanMode).toBe('baseline_only');
		expect(SCAN_POLICY.sameYearNewerPriceSheet).toBe('process');
		expect(SCAN_POLICY.latestModelYearOnly).toBe(true);
	});
});
