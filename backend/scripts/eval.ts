// Usage: node scripts/eval.ts [--base http://localhost:5173/api] <jobId>=<golden.json> ...
// Reads each job's stored report (GET /api/jobs/:id/report), compares with the golden data and
// writes backend/eval-report.md. Does not call any model.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate, toMarkdown, type Golden } from '../src/eval/metrics.ts';
import type { ReconcileResult } from '../src/pipeline/reconcile.ts';

const args = process.argv.slice(2);
const baseIdx = args.indexOf('--base');
const base = baseIdx >= 0 ? args.splice(baseIdx, 2)[1] : 'http://localhost:5173/api';
if (args.length === 0) {
	console.error('usage: node scripts/eval.ts [--base <api>] <jobId>=<golden.json> ...');
	process.exit(1);
}

const reports = [];
for (const pair of args) {
	const [jobId, goldenPath] = pair.split('=');
	const res = await fetch(`${base}/jobs/${jobId}/report`);
	if (!res.ok) throw new Error(`${jobId}: report not found (HTTP ${res.status}) — has finalize_job run?`);
	const { report, vehicle } = (await res.json()) as { report: ReconcileResult; vehicle: string };
	const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as Golden;
	reports.push(evaluate(vehicle || jobId, report, golden));
}
const md = toMarkdown(reports, new Date().toISOString());
writeFileSync(join(import.meta.dirname, '..', 'eval-report.md'), md);
console.log(md);
process.exit(reports.every((r) => r.pass.autoAccuracy && r.pass.noMissing && r.pass.ruleRecall) ? 0 : 2);
