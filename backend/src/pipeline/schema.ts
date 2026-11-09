// Extraction schema (PLAN.md §4.3). Requested from the model in three sections so each
// structured response stays small (§6.5).
import * as v from 'valibot';

export const Confidence = v.picklist(['high', 'medium', 'low']);

export const Evidence = v.object({
	/** 1-based PDF page, as shown by the `=== p.N ===` markers in the prompt. */
	page: v.pipe(v.number(), v.integer(), v.minValue(1)),
	/** Verbatim excerpt (≤ 40 chars) of the cell, sentence or footnote holding the value. */
	quote: v.string(),
	/** Footnote marker such as "※2" or "*1". */
	footnote: v.optional(v.string()),
});

export const Trim = v.object({
	name: v.string(),
	price: v.nullable(v.number()),
	priceNote: v.optional(v.string()),
	powertrain: v.optional(v.string()),
	evidence: Evidence,
	confidence: Confidence,
});

export const Color = v.object({
	kind: v.picklist(['exterior', 'interior']),
	name: v.string(),
	code: v.nullable(v.string()),
	hex: v.nullable(v.string()),
	/** ["*"] means every trim. */
	applicableTrims: v.array(v.string()),
	evidence: Evidence,
	confidence: Confidence,
});

export const Option = v.object({
	name: v.string(),
	price: v.nullable(v.number()),
	applicableTrims: v.array(v.string()),
	includes: v.array(v.string()),
	evidence: Evidence,
	confidence: Confidence,
});

export const RULE_TYPES = ['exclusive', 'requires', 'includes', 'trim_only', 'other'] as const;

export const Rule = v.object({
	type: v.picklist(RULE_TYPES),
	subject: v.string(),
	targets: v.array(v.string()),
	condition: v.string(),
	result: v.string(),
	footnoteText: v.string(),
	evidence: Evidence,
	confidence: Confidence,
});

export const DocumentInfo = v.object({
	isPriceSheet: v.boolean(),
	brand: v.nullable(v.picklist(['hyundai', 'kia', 'genesis'])),
	vehicleName: v.nullable(v.string()),
	modelYear: v.nullable(v.string()),
	effectiveDate: v.nullable(v.string()),
	notes: v.array(v.string()),
});

export const SectionTrimsColors = v.object({ document: DocumentInfo, trims: v.array(Trim), colors: v.array(Color) });
export const SectionOptions = v.object({ options: v.array(Option) });
export const SectionRules = v.object({ rules: v.array(Rule) });

export type TrimItem = v.InferOutput<typeof Trim>;
export type ColorItem = v.InferOutput<typeof Color>;
export type OptionItem = v.InferOutput<typeof Option>;
export type RuleItem = v.InferOutput<typeof Rule>;
export type DocumentInfoT = v.InferOutput<typeof DocumentInfo>;
export type EvidenceT = v.InferOutput<typeof Evidence>;

export interface Extraction {
	document: DocumentInfoT;
	trims: TrimItem[];
	colors: ColorItem[];
	options: OptionItem[];
	rules: RuleItem[];
}

export const emptyExtraction = (): Extraction => ({
	document: { isPriceSheet: false, brand: null, vehicleName: null, modelYear: null, effectiveDate: null, notes: [] },
	trims: [],
	colors: [],
	options: [],
	rules: [],
});
