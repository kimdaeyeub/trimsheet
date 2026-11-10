// Usage: node scripts/golden-from-sheet.ts <dir-with-csv> <out.json> [차종]
//   <dir> holds 트림.csv, 색상.csv, 선택품목.csv, 옵션규칙.csv exported from Google Sheets.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { goldenFromCsv } from '../src/eval/golden.ts';

const [dir, out, vehicle] = process.argv.slice(2);
if (!dir || !out) {
	console.error('usage: node scripts/golden-from-sheet.ts <csv-dir> <out.json> [차종]');
	process.exit(1);
}
const read = (name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : undefined);
const golden = goldenFromCsv({ trim: read('트림.csv'), color: read('색상.csv'), option: read('선택품목.csv'), rule: read('옵션규칙.csv') }, vehicle);
writeFileSync(out, JSON.stringify(golden, null, 2));
console.log(`wrote ${out}: 트림 ${golden.trims.length} · 색상 ${golden.colors.length} · 선택 품목 ${golden.options.length} · 규칙 ${golden.rules.length}`);
