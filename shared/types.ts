// Shared DTO types between frontend and backend.
// TYPES ONLY: this folder has no node_modules, so runtime imports would not resolve.
// Import with `import type { ... } from '@shared/types'`.

export type Brand = 'hyundai' | 'kia' | 'genesis';

export interface ApiError {
	error: { code: string; message: string };
}

export interface HealthResponse {
	ok: boolean;
	/** `ok`: connected · `not_configured`: using the in-memory placeholder · `error`: configured but failing */
	sheets: 'ok' | 'not_configured' | 'error';
	openai: boolean;
}

export interface SettingsResponse {
	spreadsheetUrl: string | null;
	/** Tab title → gid, for deep links like `<url>#gid=<gid>`. */
	tabs: Record<string, number>;
	scanPolicy: Record<string, unknown>;
}

export interface Conversation {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
}

export interface UploadResponse {
	sourceId: string;
	filename: string;
	pageCount: number | null;
	sizeBytes: number;
	/** The same file (sha256) was uploaded or collected before. */
	alreadyKnown: boolean;
}

export interface PageMap {
	cover: number[];
	price: number[];
	color: number[];
	option: number[];
	footnote: number[];
	other: number[];
}

export type JobStage = 'created' | 'prepared' | 'pass_a_done' | 'pass_b_done' | 'finalized' | 'skipped' | 'failed';
export type JobOutcome = 'ok' | 'not_pricesheet' | 'scanned' | 'duplicate' | 'older_year' | 'held' | 'error';
export type DedupAction = 'process' | 'skip' | 'hold' | 'update_candidate' | 'baseline';

export interface JobState {
	jobId: string;
	conversationId: string | null;
	sourceId: string;
	stage: JobStage;
	outcome: JobOutcome | null;
	progressNote: string;
	pageCount: number | null;
	pageMap: PageMap | null;
	isScanned: boolean | null;
	vehicle: {
		brand: Brand | null;
		name: string | null;
		modelYear: string | null;
		/** 'stated' = "20XX년형" in the PDF; otherwise inferred (see backend identity.ts). */
		modelYearSource?: 'stated' | 'effective_date' | 'first_seen' | null;
		effectiveDate: string | null;
		vehicleKey: string | null;
		familyKey: string | null;
	} | null;
	dedup: { action: DedupAction; reason: string; existingJobId?: string } | null;
	/** The user explicitly asked to (re)process — bypasses most dedup rules (PLAN.md §7.11 R11). */
	force: boolean;
	sha256: string;
	filename: string;
	sourceUrl: string | null;
	/** Vehicle lock currently held by this job (released at finalize/skip/failure). */
	lockedVehicleKey: string | null;
	models: { passA?: string; passB?: string };
	fallbackReasons: string[];
	counts: { trims: number; colors: number; options: number; rules: number; review: number } | null;
	error: string | null;
	createdAt: string;
	updatedAt: string;
}

/** One row of the `작업` tab. Korean headers are mapped in backend/src/sheets/layout.ts. */
export interface JobRow {
	jobId: string;
	conversationId: string;
	brand: string;
	vehicleName: string;
	modelYear: string;
	effectiveDate: string;
	filename: string;
	sourceUrl: string;
	pdfKey: string;
	stage: string;
	outcome: string;
	modelA: string;
	modelB: string;
	trimCount: string;
	colorCount: string;
	optionCount: string;
	ruleCount: string;
	reviewCount: string;
	createdAt: string;
	updatedAt: string;
	error: string;
}

export type SheetName = 'trim' | 'color' | 'option' | 'rule';

/** A data-tab row as returned by the API: raw cell values keyed by column key. */
export interface ItemRow {
	sheet: SheetName;
	values: Record<string, string>;
}

export interface JobDetailResponse {
	state: JobState | null;
	job: JobRow | null;
	items: Record<SheetName, Record<string, string>[]>;
	review: Record<string, string>[];
	pdfUrl: string | null;
	sheetUrl: string | null;
}

export interface Notification {
	id: string;
	kind: 'job_done' | 'job_failed' | 'scan_done' | 'scan_failed';
	title: string;
	body: string;
	jobId: string;
	scanRunId: string;
	createdAt: string;
	read: boolean;
}

export interface NotificationsResponse {
	items: Notification[];
	unread: number;
}

export type ReviewCode =
	| 'PASS_MISMATCH'
	| 'ONLY_IN_A'
	| 'ONLY_IN_B'
	| 'EVIDENCE_NOT_FOUND'
	| 'LOW_CONFIDENCE'
	| 'INVALID_PRICE'
	| 'UNKNOWN_REFERENCE'
	| 'RULE_CONFLICT'
	| 'RULE_OTHER'
	| 'DUPLICATE'
	| 'SCANNED_PDF'
	| 'FALLBACK_MODEL'
	| 'HEX_APPROX';

export interface ReviewReason {
	code: ReviewCode;
	detail?: string;
}

export type ItemAction =
	| { action: 'approve' }
	| { action: 'reject' }
	| { action: 'edit'; data: Record<string, string> };

export interface ItemActionResponse {
	itemId: string;
	sheet: SheetName;
	status: string;
	values: Record<string, string>;
}

/** One row of the 차량 registry tab. */
export interface VehicleRow {
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

export interface ScanRunsResponse {
	runs: Record<string, string>[];
	baselineDone: boolean;
	schedule: string;
}
