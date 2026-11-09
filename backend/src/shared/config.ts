// Single source of truth for models and collection policy (PLAN.md §6.2, §7.11).

export const MODELS = {
	/** Chat + tool orchestration. */
	chat: 'cloudflare/@cf/zai-org/glm-4.7-flash',
	/** Pass A / Pass B extraction (text input). */
	extract: 'cloudflare/@cf/zai-org/glm-4.7-flash',
	/** PDF-native fallback. TODO(Phase 2.0): confirm the current OpenAI model id. */
	fallback: 'openai/gpt-5.5',
} as const;

export const FALLBACK = {
	minTextCharsPerPage: 50,
	maxEvidenceMissRate: 0.3,
	maxLayoutChars: 300_000,
} as const;

export const SCAN_POLICY = {
	latestModelYearOnly: true,
	initialScanMode: 'baseline_only' as 'baseline_only' | 'process_latest',
	maxAutoProcessPerScan: 10,
	maxPriceSheetAgeDays: 400,
	unknownYear: 'hold' as const,
	sameYearNewerPriceSheet: 'process' as 'update_candidate' | 'process' | 'skip',
	lockTtlMinutes: 30,
} as const;

export const PIPELINE = {
	/**
	 * Pass A + Pass B cross-validation (Phase 4). Each `extract_pass` call gets its own
	 * invocation-scoped harness in Flue, so the two passes never see each other's conversation.
	 */
	twoPass: true,
} as const;
