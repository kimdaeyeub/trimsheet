import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, CheckCheck, CircleCheck, ExternalLink, FileText, Pencil, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import type { ItemAction, SheetName } from '@shared/types'
import { EditItemDialog, type EditTarget } from '../components/review/EditItemDialog'
import { Badge, type Tone } from '../components/ui/Badge'
import { Button, IconButton } from '../components/ui/Button'
import { buttonClass } from '../components/ui/button-styles'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { Spinner } from '../components/ui/Spinner'
import { api } from '../lib/api'
import { cn } from '../lib/cn'
import { formatWon } from '../lib/format'
import { jobStatus, modelLabel } from '../lib/labels'
import { qk } from '../lib/query'

type TabKey = 'review' | SheetName

const TABS: { key: TabKey; label: string }[] = [
  { key: 'review', label: '확인 필요' },
  { key: 'trim', label: '트림' },
  { key: 'color', label: '색상' },
  { key: 'option', label: '선택 품목' },
  { key: 'rule', label: '옵션 규칙' },
]

const STATUS_TONE: Record<string, Tone> = { '자동 확정': 'success', '확인 필요': 'warning', 승인: 'primary', 수정됨: 'primary', 제외: 'neutral' }

type Row = Record<string, string>
const COLUMNS: Record<TabKey, { key: string; label: string; render?: (r: Row) => string }[]> = {
  review: [
    { key: 'sheet', label: '시트' },
    { key: 'label', label: '항목' },
    { key: 'reasons', label: '사유' },
    { key: 'passA', label: '1차 값' },
    { key: 'passB', label: '2차 값' },
  ],
  trim: [
    { key: 'name', label: '트림' },
    { key: 'price', label: '가격', render: (r) => formatWon(r.price) },
    { key: 'priceNote', label: '비고' },
  ],
  color: [
    { key: 'kind', label: '구분' },
    { key: 'name', label: '색상명' },
    { key: 'code', label: '코드' },
    { key: 'hex', label: '헥사(근사)' },
    { key: 'applicableTrims', label: '적용 트림' },
  ],
  option: [
    { key: 'name', label: '옵션명' },
    { key: 'price', label: '가격', render: (r) => formatWon(r.price) },
    { key: 'applicableTrims', label: '적용 트림' },
  ],
  rule: [
    { key: 'type', label: '유형' },
    { key: 'condition', label: '조건' },
    { key: 'result', label: '결과' },
    { key: 'footnoteText', label: '원문 각주' },
  ],
}

export function JobDetailPage() {
  const { jobId = '' } = useParams()
  const [tab, setTab] = useState<TabKey>('review')
  const [page, setPage] = useState<number | null>(null)
  const job = useQuery({ queryKey: qk.job(jobId), queryFn: () => api.job(jobId) })
  const qc = useQueryClient()
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: qk.job(jobId) })
  const act = useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: ItemAction }) => api.itemAction(jobId, itemId, body),
    onMutate: () => setActionError(null),
    onSuccess: () => {
      setEditing(null)
      void refresh()
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : '저장하지 못했습니다.'),
  })
  const approveAll = useMutation({
    mutationFn: () => api.approveAllAuto(jobId),
    onSuccess: () => void refresh(),
    onError: (e) => setActionError(e instanceof Error ? e.message : '일괄 승인하지 못했습니다.'),
  })

  if (job.isLoading) {
    return (
      <div className="flex justify-center py-24 text-gray-400">
        <Spinner className="size-5" />
      </div>
    )
  }
  if (job.isError || !job.data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <ErrorNotice error={job.error ?? new Error('작업을 찾을 수 없습니다.')} onRetry={() => job.refetch()} />
      </div>
    )
  }

  const { job: row, state, items, review, pdfUrl, sheetUrl } = job.data
  const title = row?.vehicleName || state?.vehicle?.name || state?.filename || jobId
  const status = row ? jobStatus(row) : null
  const pendingReview = review.filter((r) => r.progress !== '완료')
  const counts = { review: pendingReview.length, trim: items.trim.length, color: items.color.length, option: items.option.length, rule: items.rule.length }
  const rows: Row[] = tab === 'review' ? [...pendingReview, ...review.filter((r) => r.progress === '완료')] : items[tab]
  const autoCount = (Object.values(items) as Row[][]).flat().filter((r) => r.status === '자동 확정').length
  const busy = act.isPending || approveAll.isPending

  /** Data-tab row for an item id (review rows only carry summaries). */
  const findItem = (itemId: string): { sheet: SheetName; values: Row } | null => {
    for (const sheet of ['trim', 'color', 'option', 'rule'] as SheetName[]) {
      const values = items[sheet].find((r) => r.itemId === itemId)
      if (values) return { sheet, values }
    }
    return null
  }
  const openEdit = (r: Row) => {
    const found = findItem(r.itemId)
    if (!found) return setActionError('이 항목을 시트에서 찾을 수 없습니다. 새로 고침해 보세요.')
    const reviewRow = review.find((x) => x.itemId === r.itemId)
    setEditing({ ...found, itemId: r.itemId, passA: reviewRow?.passA, passB: reviewRow?.passB, reasons: reviewRow?.reasons })
  }
  const isHexSummary = (r: Row) => r.itemId?.startsWith('hexsum_')
  const statusOf = (r: Row) =>
    (isHexSummary(r) ? (r.progress === '완료' ? '승인' : '확인 필요') : tab === 'review' ? findItem(r.itemId)?.values.status : r.status) ?? ''

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-6 lg:h-full lg:flex-row">
      <section className="flex min-w-0 flex-col gap-4 lg:w-3/5">
        <div>
          <Link to="/jobs" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft className="size-4" aria-hidden /> 작업 결과
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">
              {title} {row?.modelYear && <span className="text-gray-500">{row.modelYear}년형</span>}
            </h1>
            {status && <Badge tone={status.tone}>{status.label}</Badge>}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {[row?.effectiveDate && `${row.effectiveDate} 기준`, row?.modelA && `1차 ${modelLabel(row.modelA)}`, row?.modelB && `2차 ${modelLabel(row.modelB)}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {state?.progressNote && state.stage !== 'finalized' && <p className="mt-1 text-sm text-gray-600">{state.progressNote}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {sheetUrl && (
              <a href={sheetUrl} target="_blank" rel="noreferrer" className={buttonClass('primary', 'sm')}>
                Google Sheets에서 보기 <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
            {pdfUrl && (
              <a href={pdfUrl} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'sm')}>
                <FileText className="size-3.5" aria-hidden /> 원본 PDF
              </a>
            )}
            {autoCount > 0 && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => approveAll.mutate()}>
                <CheckCheck className="size-3.5" aria-hidden /> 자동 확정 {autoCount}건 모두 승인
              </Button>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-400">시트에서 직접 고친 내용도 이 화면에 반영됩니다.</p>
        </div>

        {review.length > 0 && pendingReview.length === 0 && (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-success-500/30 bg-success-50 px-3 py-2 text-sm text-success-700">
            <CircleCheck className="size-4" aria-hidden /> 검토 완료 — 확인 필요 항목을 모두 처리했습니다. Google Sheets에 반영되어 있습니다.
          </div>
        )}
        {actionError && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {actionError}
          </p>
        )}

        <div role="tablist" aria-label="결과 시트" className="flex gap-1 overflow-x-auto border-b border-gray-200">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap',
                tab === t.key ? 'border-primary-500 font-semibold text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-800',
              )}
            >
              {t.label} <span className={cn('ml-0.5 text-xs', t.key === 'review' && counts.review > 0 ? 'text-warning-700' : 'text-gray-400')}>{counts[t.key]}</span>
            </button>
          ))}
        </div>

        <Card className="min-h-0 overflow-auto lg:flex-1">
          {rows.length === 0 ? (
            <EmptyState title={tab === 'review' ? '확인할 항목이 없습니다' : '항목이 없습니다'} />
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b border-gray-200 bg-white text-left text-xs text-gray-500">
                <tr>
                  {COLUMNS[tab].map((c) => (
                    <th key={c.key} className="px-3 py-2.5 font-medium">
                      {c.label}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 font-medium">상태</th>
                  <th className="px-3 py-2.5 font-medium">근거</th>
                  <th className="px-3 py-2.5 font-medium">
                    <span className="sr-only">작업</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 align-top">
                {rows.map((r, i) => (
                  <tr key={r.itemId || i} className={cn(tab === 'review' && r.progress === '완료' && 'opacity-50', statusOf(r) === '제외' && 'text-gray-400 line-through')}>
                    {COLUMNS[tab].map((c) => (
                      <td key={c.key} className={cn('px-3 py-2.5', c.key === 'footnoteText' && 'max-w-xs text-xs text-gray-600')}>
                        {c.key === 'hex' && r.hex ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="size-4 rounded border border-gray-200" style={{ backgroundColor: r.hex }} aria-hidden /> {r.hex}
                            {r.hexSource && <span className="text-xs text-gray-400">{r.hexSource}</span>}
                          </span>
                        ) : c.render ? (
                          c.render(r)
                        ) : (
                          r[c.key] || '—'
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2.5">
                      <Badge tone={STATUS_TONE[statusOf(r)] ?? 'neutral'}>{statusOf(r) || '—'}</Badge>
                      {tab !== 'review' && r.reviewReasons && <span className="mt-1 block max-w-48 text-xs text-gray-500">{r.reviewReasons}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.evidencePage ? (
                        <button
                          className="text-primary-600 hover:underline"
                          title={r.evidenceQuote}
                          onClick={() => setPage(Number(r.evidencePage))}
                        >
                          p.{r.evidencePage}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {r.itemId && (
                        <span className="flex gap-0.5">
                          <IconButton label="승인" className="size-8 hover:text-success-700" disabled={busy || statusOf(r) === '승인'} onClick={() => act.mutate({ itemId: r.itemId, body: { action: 'approve' } })}>
                            <Check className="size-4" />
                          </IconButton>
                          {!isHexSummary(r) && (
                            <>
                              <IconButton label="수정" className="size-8 hover:text-primary-600" disabled={busy} onClick={() => openEdit(r)}>
                                <Pencil className="size-4" />
                              </IconButton>
                              <IconButton label="제외" className="size-8 hover:text-danger-700" disabled={busy || statusOf(r) === '제외'} onClick={() => act.mutate({ itemId: r.itemId, body: { action: 'reject' } })}>
                                <X className="size-4" />
                              </IconButton>
                            </>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>

      {editing && (
        <EditItemDialog
          key={editing.itemId}
          target={editing}
          saving={act.isPending}
          error={actionError}
          onClose={() => (setEditing(null), setActionError(null))}
          onSave={(data) => act.mutate({ itemId: editing.itemId, body: { action: 'edit', data } })}
        />
      )}

      <section className="min-h-[60vh] lg:h-full lg:w-2/5" aria-label="원본 PDF">
        {pdfUrl ? (
          <iframe key={page ?? 0} title="원본 PDF" src={`${pdfUrl}${page ? `#page=${page}` : ''}`} className="h-full min-h-[60vh] w-full rounded-[var(--radius-card)] border border-gray-200 bg-white" />
        ) : (
          <Card className="flex h-full items-center justify-center">
            <EmptyState title="원본 PDF가 없습니다" />
          </Card>
        )}
      </section>
    </div>
  )
}
