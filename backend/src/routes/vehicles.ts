import { Hono } from 'hono';
import { getRepo } from '../sheets/index.ts';
import { startTrimSheetJob } from '../shared/dispatch.ts';
import { AppError } from '../shared/errors.ts';

export const vehicles = new Hono<{ Bindings: Env }>();

vehicles.get('/', async (c) => {
	const brand = c.req.query('brand');
	const status = c.req.query('status');
	const list = (await getRepo(c.env).listVehicles()).filter((v) => (!brand || v.brand === brand) && (!status || v.status === status));
	return c.json(list.sort((a, b) => a.brand.localeCompare(b.brand) || a.vehicleName.localeCompare(b.vehicleName, 'ko')));
});

/** The user asks to process a baseline / held / update-candidate vehicle (PLAN.md §7.11, R11). */
vehicles.post('/:key/process', async (c) => {
	const repo = getRepo(c.env);
	const key = decodeURIComponent(c.req.param('key'));
	const v = (await repo.listVehicles()).find((x) => x.vehicleKey === key);
	if (!v) throw new AppError('not_found', '차량을 찾을 수 없습니다.', 404);
	if (!v.sourceId) throw new AppError('no_source', '이 차량은 저장된 가격표 PDF가 없습니다. 수집을 다시 실행하거나 PDF를 올려 주세요.');
	if (v.status === '처리 중') throw new AppError('busy', '이미 처리 중입니다.', 409);
	const conv = await repo.createConversation(`${v.vehicleName} ${v.modelYear}`.trim());
	await startTrimSheetJob({
		conversationId: conv.id,
		sourceId: v.sourceId,
		filename: v.vehicleName,
		note: '사용자가 수집 현황에서 이 차량의 정리를 직접 요청했습니다. 그래도 정리해 줘.',
	});
	return c.json({ conversationId: conv.id }, 202);
});

vehicles.post('/:key/dismiss', async (c) => {
	const repo = getRepo(c.env);
	const key = decodeURIComponent(c.req.param('key'));
	const v = (await repo.listVehicles()).find((x) => x.vehicleKey === key);
	if (!v) throw new AppError('not_found', '차량을 찾을 수 없습니다.', 404);
	await repo.upsertVehicle({ vehicleKey: key, reason: `${v.reason} · 사용자가 무시함` });
	return c.body(null, 204);
});
