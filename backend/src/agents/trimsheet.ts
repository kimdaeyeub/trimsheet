'use agent';
import { useModel, useTool } from '@flue/runtime';
import { MODELS } from '../shared/config.ts';
import { extractPass } from '../tools/extract-pass.ts';
import { finalizeJob } from '../tools/finalize-job.ts';
import { getJob } from '../tools/get-job.ts';
import { prepareSource } from '../tools/prepare-source.ts';
import { registerPdfUrl } from '../tools/register-pdf-url.ts';
import { searchVehicles } from '../tools/search-vehicles.ts';
import { SYSTEM_PROMPT } from './trimsheet.prompt.ts';

// TrimSheet: the conversational agent (PLAN.md §6.3). Phase 5 adds find_pdfs_on_page.
export function TrimSheet() {
	useModel(MODELS.chat);
	useTool(registerPdfUrl);
	useTool(prepareSource);
	useTool(extractPass);
	useTool(finalizeJob);
	useTool(getJob);
	useTool(searchVehicles);
	return SYSTEM_PROMPT;
}
