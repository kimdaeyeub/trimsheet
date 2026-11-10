// Build golden data from CSV files laid out like the TrimSheet sheet tabs (PLAN.md Phase 8.1).
// Each CSV is one tab exported from Google Sheets (File → Download → CSV): 트림.csv, 색상.csv,
// 선택품목.csv, 옵션규칙.csv — same Korean headers as backend/src/sheets/layout.ts.
import { parsePrice } from '../pipeline/normalize.ts';
import type { ColorItem, OptionItem, RuleItem, TrimItem } from '../pipeline/schema.ts';
import type { Golden } from './metrics.ts';

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	const s = text.replace(/^﻿/, '');
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (quoted) {
			if (ch === '"' && s[i + 1] === '"') (field += '"', i++);
			else if (ch === '"') quoted = false;
			else field += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ',') (row.push(field), (field = ''));
		else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && s[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else field += ch;
	}
	if (field || row.length) (row.push(field), rows.push(row));
	return rows.filter((r) => r.some((c) => c.trim()));
}

function records(csv: string | undefined): Record<string, string>[] {
	if (!csv) return [];
	const [header, ...rows] = parseCsv(csv);
	return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const list = (s: string) => (s === '전 트림' || s === '' ? ['*'] : s.split(/\s*,\s*/).filter(Boolean));
const ev = { page: 1, quote: '' };
const RULE_TYPE: Record<string, RuleItem['type']> = { 상호배제: 'exclusive', 의존성: 'requires', 포함: 'includes', '트림 한정': 'trim_only', 기타: 'other' };

/** Rows are filtered to one vehicle when `vehicle` is given (matches the 차종 column). */
export function goldenFromCsv(tabs: { trim?: string; color?: string; option?: string; rule?: string }, vehicle?: string): Golden {
	const pick = (rs: Record<string, string>[]) => rs.filter((r) => !vehicle || !r['차종'] || r['차종'] === vehicle).filter((r) => r['상태'] !== '제외');
	const trims: TrimItem[] = pick(records(tabs.trim)).map((r) => ({ name: r['트림'], price: parsePrice(r['가격(원)'] ?? ''), evidence: ev, confidence: 'high' }));
	const colors: ColorItem[] = pick(records(tabs.color)).map((r) => ({
		kind: r['구분'] === '내장' ? 'interior' : 'exterior',
		name: r['색상명'],
		code: r['색상 코드'] || null,
		hex: r['헥사코드(근사값)'] || null,
		applicableTrims: list(r['적용 트림'] ?? ''),
		evidence: ev,
		confidence: 'high',
	}));
	const options: OptionItem[] = pick(records(tabs.option)).map((r) => ({
		name: r['옵션명'],
		price: parsePrice(r['가격(원)'] ?? ''),
		applicableTrims: list(r['적용 트림'] ?? ''),
		includes: r['포함 사양'] ? r['포함 사양'].split(/\s*,\s*/) : [],
		evidence: ev,
		confidence: 'high',
	}));
	const rules: RuleItem[] = pick(records(tabs.rule)).map((r) => ({
		type: RULE_TYPE[r['유형']] ?? 'other',
		subject: r['대상 옵션'],
		targets: (r['관련 항목'] ?? '').split(/\s*,\s*/).filter(Boolean),
		condition: r['조건'] ?? '',
		result: r['결과'] ?? '',
		footnoteText: r['원문 각주'] ?? '',
		evidence: ev,
		confidence: 'high',
	}));
	return { trims: trims.filter((t) => t.name), colors: colors.filter((c) => c.name), options: options.filter((o) => o.name), rules: rules.filter((r) => r.subject) };
}
