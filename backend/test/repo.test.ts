import { beforeEach, describe, expect, it } from 'vitest';
import { TAB_LIST, TABS, headersOf } from '../src/sheets/layout.ts';
import { MemorySheetsPort } from '../src/sheets/memory.ts';
import { SheetsRepo, resetLayoutMemo } from '../src/sheets/repo.ts';

let port: MemorySheetsPort;
let repo: SheetsRepo;

beforeEach(() => {
	resetLayoutMemo();
	port = new MemorySheetsPort();
	repo = new SheetsRepo(port, 'memory-test');
});

describe('SheetsRepo', () => {
	it('creates every tab with its header and initialises baseline_done=FALSE', async () => {
		await repo.ensureLayout();
		expect([...port.tabs.keys()]).toEqual(TAB_LIST.map((t) => t.title));
		expect(port.tabs.get('작업')?.rows[0]).toEqual(headersOf(TABS.job));
		expect(port.tabs.get('_대화')?.hidden).toBe(true);
		expect(await repo.getSetting('baseline_done')).toBe('FALSE');
	});

	it('rejects a spreadsheet whose existing tab lost a column', async () => {
		await port.addTabs([TABS.job]);
		port.tabs.get('작업')!.rows[0] = headersOf(TABS.job).filter((h) => h !== '단계');
		await expect(repo.ensureLayout()).rejects.toThrow(/단계/);
	});

	it('creates, renames, lists and soft-deletes conversations', async () => {
		const a = await repo.createConversation('스타리아');
		const b = await repo.createConversation('G80');
		await repo.updateConversation(a.id, { title: '스타리아 Electric' });
		await repo.updateConversation(b.id, { deleted: true });
		const list = await repo.listConversations();
		expect(list.map((c) => c.title)).toEqual(['스타리아 Electric']);
		await expect(repo.updateConversation(b.id, { title: 'x' })).rejects.toThrow(/찾을 수 없습니다/);
	});

	it('adds a PDF source only once', async () => {
		const input = {
			sourceId: 'src_1',
			origin: 'upload' as const,
			filename: 'a.pdf',
			pdfKey: 'pdf/aa.pdf',
			sha256: 'aa',
			sizeBytes: 10,
			pageCount: 2,
		};
		expect(await repo.addPdfSourceIfNew(input)).toBe(true);
		expect(await repo.addPdfSourceIfNew(input)).toBe(false);
		expect((await repo.findPdfSource('src_1'))?.pageCount).toBe('2');
	});

	it('lists notifications newest first and marks them read', async () => {
		await repo.addNotification({ id: 'n1', kind: 'job_done', title: '완료', body: '', jobId: 'job_1', scanRunId: '' });
		const before = await repo.listNotifications();
		expect(before.unread).toBe(1);
		await repo.markNotificationRead('n1');
		expect((await repo.listNotifications()).unread).toBe(0);
	});

	it('returns only the items of the requested job', async () => {
		await repo.ensureLayout();
		await port.append('트림', [
			['itm_1', 'job_1', '현대', '스타리아', '2027', '카고', 41250000],
			['itm_2', 'job_2', '현대', '스타리아', '2027', '라운지', 50000000],
		]);
		const { items } = await repo.getJobItems('job_1');
		expect(items.trim.map((r) => [r.itemId, r.price])).toEqual([['itm_1', '41250000']]);
		expect(items.color).toEqual([]);
	});
});
