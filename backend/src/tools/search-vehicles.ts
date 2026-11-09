import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { compact } from '../pipeline/normalize.ts';
import { deps, jobUrl } from './common.ts';

export const searchVehicles = defineTool({
	name: 'search_vehicles',
	description: '이미 등록된 차량(차종·연식·상태·최근 작업)을 이름으로 찾습니다. 사용자가 차종 이름만 말했을 때 먼저 호출하세요.',
	input: v.object({ query: v.pipe(v.string(), v.minLength(1)) }),
	async run({ data }) {
		const q = compact(data.query);
		const vehicles = (await deps().repo.listVehicles())
			.filter((r) => compact(`${r.brand}${r.vehicleName}${r.modelYear}`).includes(q) || q.includes(compact(r.vehicleName)))
			.slice(0, 20)
			.map((r) => ({
				vehicleName: r.vehicleName,
				brand: r.brand,
				modelYear: r.modelYear,
				effectiveDate: r.effectiveDate,
				status: r.status,
				sourceId: r.sourceId,
				lastJobId: r.lastJobId,
				jobUrl: r.lastJobId ? jobUrl(r.lastJobId) : null,
			}));
		return { output: { vehicles } };
	},
});
