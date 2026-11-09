'use agent';
import { useModel, useTool } from '@flue/runtime';
import { MODELS } from '../shared/config.ts';
import { scanBrands } from '../tools/scan-brands.ts';

// Watcher: weekly / manual scan of the three manufacturer sites (PLAN.md §6.6).
// All the work is in one deterministic tool so the model is called as little as possible.
export function Watcher() {
	useModel(MODELS.chat);
	useTool(scanBrands);
	return `당신은 TrimSheet의 수집 담당입니다.
- weekly_scan 신호를 받으면 신호의 scanRunId와 mode를 그대로 넣어 scan_brands를 **한 번만** 호출합니다.
- 결과를 한국어 두세 문장으로 요약합니다: 처리 시작한 차량, 보류, 기준선 등록 수, 수집 실패.
- 다른 도구를 부르거나 추측하지 않습니다.`;
}
