// Puts golden-draft CSVs into the connected Google Sheet so they show up in the app for review,
// or removes them again. Rows get jobId `golden_<n>` and status 확인 필요 so they are never
// mistaken for processed data. Does not touch the 차량 tab, so duplicate detection is unaffected.
//
//   npx tsx scripts/golden-to-sheet.ts add <csv-dir>
//   npx tsx scripts/golden-to-sheet.ts remove
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../src/eval/golden.ts';
import { getRepo } from '../src/sheets/index.ts';
import { TABS, type TabSpec } from '../src/sheets/layout.ts';
import { toCells, toRecords } from '../src/sheets/rows.ts';

const PREFIX = 'golden_';
const BRAND: Record<string, string> = { 'G80': '제네시스', '쏘렌토': '기아', '더 뉴 스타리아 Electric': '현대' };
const EFFECTIVE: Record<string, string> = { 'G80': '2026-11-01', '더 뉴 스타리아 Electric': '2026-04-23' };

function loadEnv(path: string) {
	const env: Record<string, string> = {};
	const text = readFileSync(path, 'utf8');
	for (const m of text.matchAll(/^([A-Z_][A-Z0-9_]*)=(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(.*))$/gm)) {
		env[m[1]] = (m[2] ?? m[3] ?? m[4] ?? '').replace(/\\n/g, '\n').trim();
	}
	return env;
}

const env = loadEnv(join(import.meta.dirname, '..', '.env'));
const repo = getRepo(env);
if (repo.port.kind !== 'google') throw new Error('backend/.env에 Google Sheets 설정이 없습니다.');

const [cmd, dir] = process.argv.slice(2);
const now = new Date(Date.now() + 9 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
const ITEM_TABS = [TABS.trim, TABS.color, TABS.option, TABS.rule, TABS.job] as TabSpec[];

if (cmd === 'remove') {
	await repo.ensureLayout();
	const raw = await repo.port.readTabs(ITEM_TABS.map((t) => t.title));
	for (const spec of ITEM_TABS) {
		const rows = toRecords(spec, raw[spec.title] ?? []).filter((r) => r.values.jobId?.startsWith(PREFIX)).map((r) => r.row);
		await repo.port.deleteRows(spec.title, rows);
		console.log(`${spec.title}: ${rows.length}행 삭제`);
	}
} else if (cmd === 'add' && dir) {
	await repo.ensureLayout();
	const read = (name: string) => {
		const p = join(dir, name);
		if (!existsSync(p)) return [];
		const [header, ...rows] = parseCsv(readFileSync(p, 'utf8'));
		return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
	};
	const csv = { trim: read('트림.csv'), color: read('색상.csv'), option: read('선택품목.csv'), rule: read('옵션규칙.csv') };
	const vehicles = [...new Set(csv.trim.map((r) => r['차종']))];
	const page = (s: string) => (s.match(/\d+/)?.[0] ?? '');
	let n = 0;
	for (const [vi, name] of vehicles.entries()) {
		const jobId = `${PREFIX}${vi + 1}`;
		const head = (i: number, kind: string) => ({ itemId: `${jobId}_${kind}${i}`, jobId, brand: BRAND[name] ?? '', vehicleName: name, modelYear: '2026' });
		const tail = { status: '확인 필요', reviewReasons: '정답 초안(사람이 PDF를 읽고 작성)', updatedAt: now };
		const mine = (rows: Record<string, string>[]) => rows.filter((r) => r['차종'] === name);
		const put = async (spec: TabSpec, objs: Record<string, string | number>[]) => {
			if (objs.length) await repo.port.append(spec.title, objs.map((o) => toCells(spec, o)));
			n += objs.length;
		};
		await put(TABS.trim as TabSpec, mine(csv.trim).map((r, i) => ({ ...head(i, 't'), name: r['트림'], price: Number(r['가격(원)']), evidencePage: page(r['근거 페이지']), ...tail })));
		await put(TABS.color as TabSpec, mine(csv.color).map((r, i) => ({ ...head(i, 'c'), kind: r['구분'], name: r['색상명'], code: r['색상 코드'], applicableTrims: r['적용 트림'], evidencePage: page(r['근거 페이지']), ...tail })));
		await put(TABS.option as TabSpec, mine(csv.option).map((r, i) => ({ ...head(i, 'o'), name: r['옵션명'], price: Number(r['가격(원)']), applicableTrims: r['적용 트림'], evidencePage: page(r['근거 페이지']), ...tail })));
		await put(TABS.rule as TabSpec, mine(csv.rule).map((r, i) => ({ ...head(i, 'r'), type: r['유형'], subject: r['대상 옵션'], targets: r['관련 항목'], condition: r['조건'], result: r['결과'], footnoteText: r['원문 각주'], evidencePage: page(r['근거 페이지']), ...tail })));
		await repo.createJobRow({ jobId, brand: BRAND[name] ?? '', vehicleName: name, modelYear: '2026', effectiveDate: EFFECTIVE[name] ?? '', stage: 'done', outcome: '정답 초안' });
		console.log(`${name}: ${jobId}`);
	}
	console.log(`추가 ${n}행`);
} else {
	console.error('usage: npx tsx scripts/golden-to-sheet.ts add <csv-dir> | remove');
	process.exit(1);
}
