import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { deps, jobUrl, loadState } from './common.ts';

export const getJob = defineTool({
	name: 'get_job',
	description: '작업(jobId)의 현재 단계, 결과, 개수를 확인합니다.',
	input: v.object({ jobId: v.pipe(v.string(), v.startsWith('job_')) }),
	async run({ data }) {
		const s = await loadState(deps().bucket, data.jobId);
		return {
			output: {
				jobId: s.jobId,
				stage: s.stage,
				outcome: s.outcome,
				progressNote: s.progressNote,
				vehicle: s.vehicle ? { name: s.vehicle.name, modelYear: s.vehicle.modelYear } : null,
				counts: s.counts,
				error: s.error,
				jobUrl: jobUrl(s.jobId),
			},
		};
	},
});
