// Vehicle-by-vehicle catalog of the sheet data, paginated (the frontend's only screen).
import { Hono } from 'hono';
import type { CatalogDetail, CatalogPage } from '@shared/types';
import { buildCatalog, paginate } from '../catalog/catalog.ts';
import { getRepo } from '../sheets/index.ts';
import { AppError } from '../shared/errors.ts';

export const catalog = new Hono<{ Bindings: Env }>();

// Paging through the list would otherwise re-read four tabs from Google Sheets on every click
// (Sheets API: 60 reads/min per user). Per-isolate cache, refreshed with ?fresh=1.
const TTL_MS = 30_000;
let cached: { at: number; data: CatalogDetail[] } | null = null;

async function load(env: Env, fresh: boolean): Promise<CatalogDetail[]> {
	if (!fresh && cached && Date.now() - cached.at < TTL_MS) return cached.data;
	const data = buildCatalog(await getRepo(env).readCatalogRows());
	cached = { at: Date.now(), data };
	return data;
}

/** Test hook: forget the cached catalog. */
export const resetCatalogCache = () => {
	cached = null;
};

const int = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : undefined);

catalog.get('/', async (c) => {
	const data = await load(c.env, c.req.query('fresh') === '1');
	return c.json<CatalogPage>(
		paginate(data, { page: int(c.req.query('page')), pageSize: int(c.req.query('pageSize')), brand: c.req.query('brand') || undefined, q: c.req.query('q') || undefined }),
	);
});

catalog.get('/:id', async (c) => {
	const data = await load(c.env, c.req.query('fresh') === '1');
	const v = data.find((x) => x.id === c.req.param('id'));
	if (!v) throw new AppError('not_found', '차량을 찾을 수 없습니다. 목록을 새로고침해 보세요.', 404);
	return c.json<CatalogDetail>(v);
});
