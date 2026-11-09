import type { Brand } from '@shared/types';
import type { ListResult } from '../types.ts';
import { listGenesis } from './genesis.ts';
import { listHyundai } from './hyundai.ts';
import { listKia } from './kia.ts';

/** Current line-up price sheets for a brand (PLAN.md §6.1). Only current models are listed. */
export function listBrand(brand: Brand, env: { BROWSER: BrowserRun }, signal?: AbortSignal): Promise<ListResult> {
	switch (brand) {
		case 'hyundai':
			return listHyundai(env.BROWSER);
		case 'kia':
			return listKia(env.BROWSER);
		case 'genesis':
			return listGenesis(signal);
	}
}
