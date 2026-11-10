import type { CatalogColor, CatalogOption, CatalogRule, CatalogTrim } from '@shared/types'
import { ArrowRight } from 'lucide-react'
import { useContext, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { formatWon, splitList } from '../../lib/format'
import { Badge, type Tone } from '../ui/Badge'
import { PdfUrlContext } from './pdf-context'

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-gray-500">{children}</p>
}

/** "p.3" — a link to that page of the original PDF when the PDF is stored. */
function Page({ page }: { page: string }) {
  const pdfUrl = useContext(PdfUrlContext)
  if (!page) return null
  if (!pdfUrl) return <span className="text-xs text-gray-400 tabular-nums">p.{page}</span>
  return (
    <a
      href={`${pdfUrl}#page=${encodeURIComponent(page)}`}
      target="_blank"
      rel="noreferrer"
      title={`원문 PDF ${page}쪽 열기`}
      className="rounded text-xs whitespace-nowrap text-primary-600 tabular-nums underline-offset-2 hover:underline"
    >
      p.{page}
    </a>
  )
}

/** "전 트림" when the list names every trim; otherwise chips. */
function TrimChips({ value, allTrims }: { value: string; allTrims: readonly string[] }) {
  const list = splitList(value)
  const all = value === '전 트림' || (allTrims.length > 1 && list.length === allTrims.length && allTrims.every((t) => list.includes(t)))
  if (all) return <Badge tone="primary">전 트림</Badge>
  if (list.length === 0) return <span className="text-gray-400">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((t) => (
        <Badge key={t}>{t}</Badge>
      ))}
    </div>
  )
}

const th = 'px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-gray-500'
const td = 'px-3 py-2.5 align-top'

function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[560px] border-separate border-spacing-0 text-sm">
        <thead className="[&_th]:border-b [&_th]:border-gray-200">{head}</thead>
        <tbody className="[&_td]:border-b [&_td]:border-gray-100">{children}</tbody>
      </table>
    </div>
  )
}

export function TrimsSection({ trims }: { trims: CatalogTrim[] }) {
  if (trims.length === 0) return <Empty>정리된 트림이 없습니다.</Empty>
  return (
    <Table
      head={
        <tr>
          <th className={th}>트림</th>
          <th className={cn(th, 'text-right')}>판매 가격</th>
          <th className={th}>비고</th>
          <th className={cn(th, 'text-right')}>근거</th>
        </tr>
      }
    >
      {trims.map((t, i) => (
        <tr key={`${t.name}-${i}`}>
          <td className={cn(td, 'font-medium text-gray-900')}>
            <div className="flex flex-wrap items-center gap-1.5">
              {t.name}
            </div>
            {t.powertrain && <p className="mt-0.5 text-xs font-normal text-gray-500">{t.powertrain}</p>}
          </td>
          <td className={cn(td, 'text-right font-semibold whitespace-nowrap text-gray-900 tabular-nums')}>{formatWon(t.price)}</td>
          <td className={cn(td, 'text-gray-600')}>{t.priceNote || <span className="text-gray-300">—</span>}</td>
          <td className={cn(td, 'text-right')}>
            <Page page={t.page} />
          </td>
        </tr>
      ))}
    </Table>
  )
}

export function OptionsSection({ options, allTrims }: { options: CatalogOption[]; allTrims: readonly string[] }) {
  if (options.length === 0) return <Empty>정리된 선택 품목이 없습니다.</Empty>
  return (
    <Table
      head={
        <tr>
          <th className={th}>선택 품목</th>
          <th className={cn(th, 'text-right')}>가격</th>
          <th className={th}>선택 가능한 트림</th>
          <th className={cn(th, 'text-right')}>근거</th>
        </tr>
      }
    >
      {options.map((o, i) => (
        <tr key={`${o.name}-${i}`}>
          <td className={cn(td, 'max-w-[280px]')}>
            <div className="flex flex-wrap items-center gap-1.5 font-medium text-gray-900">
              {o.name}
            </div>
            {o.includes && <p className="mt-0.5 line-clamp-2 text-xs text-gray-500" title={o.includes}>{o.includes}</p>}
          </td>
          <td className={cn(td, 'text-right font-semibold whitespace-nowrap text-gray-900 tabular-nums')}>{formatWon(o.price)}</td>
          <td className={td}>
            <TrimChips value={o.applicableTrims} allTrims={allTrims} />
          </td>
          <td className={cn(td, 'text-right')}>
            <Page page={o.page} />
          </td>
        </tr>
      ))}
    </Table>
  )
}

const CHECKER = 'repeating-conic-gradient(#e5e7eb 0% 25%, #fff 0% 50%) 50% / 10px 10px'

export function ColorsSection({ colors, allTrims }: { colors: CatalogColor[]; allTrims: readonly string[] }) {
  if (colors.length === 0) return <Empty>정리된 색상이 없습니다.</Empty>
  const groups = ['외장', '내장'].map((k) => ({ kind: k, items: colors.filter((c) => (k === '외장' ? c.kind !== '내장' : c.kind === '내장')) }))
  return (
    <div className="flex flex-col gap-6">
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <div key={g.kind}>
            <h3 className="mb-2 text-sm font-semibold text-gray-700">
              {g.kind} 색상 <span className="font-normal text-gray-400">{g.items.length}</span>
            </h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {g.items.map((c, i) => (
                <li key={`${c.name}-${c.code}-${i}`} className="flex gap-3 rounded-lg border border-gray-200 p-3">
                  <span
                    aria-hidden
                    className="size-10 shrink-0 rounded-full border border-black/10 shadow-inner"
                    style={{ background: /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : CHECKER }}
                    title={c.hex ? `${c.hex} (근사값)` : '헥사코드 없음'}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-medium text-gray-900">{c.name}</p>
                      {c.code && <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{c.code}</code>}
                    </div>
                    <div className="mt-1.5">
                      <TrimChips value={c.applicableTrims} allTrims={allTrims} />
                    </div>
                  </div>
                  <Page page={c.page} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      <p className="text-xs text-gray-400">색 견본은 PDF에서 뽑은 근사값입니다. 실제 차량 색상과 다를 수 있습니다.</p>
    </div>
  )
}

const RULE_TONE: Record<string, Tone> = { 상호배제: 'danger', 의존성: 'primary', 포함: 'success', '트림 한정': 'warning' }
const RULE_HINT: Record<string, string> = {
  상호배제: '함께 선택할 수 없음',
  의존성: '먼저 선택해야 함',
  포함: '함께 포함됨',
  '트림 한정': '특정 트림에서만',
}

export function RulesSection({ rules }: { rules: CatalogRule[] }) {
  if (rules.length === 0) return <Empty>정리된 옵션 규칙이 없습니다.</Empty>
  return (
    <ul className="flex flex-col gap-2">
      {rules.map((r, i) => (
        <li key={`${r.subject}-${i}`} className="rounded-lg border border-gray-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={RULE_TONE[r.type] ?? 'neutral'}>{r.type || '기타'}</Badge>
            {RULE_HINT[r.type] && <span className="text-xs text-gray-500">{RULE_HINT[r.type]}</span>}
            <span className="ml-auto">
              <Page page={r.page} />
            </span>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-gray-900">
            {r.subject}
            {r.targets && (
              <>
                <ArrowRight className="size-4 text-gray-400" aria-hidden />
                <span className="text-gray-700">{r.targets}</span>
              </>
            )}
          </p>
          {(r.condition || r.result) && (
            <p className="mt-1 text-sm text-gray-600">
              {r.condition && <span>{r.condition}</span>}
              {r.condition && r.result && <span className="text-gray-400"> → </span>}
              {r.result && <span>{r.result}</span>}
            </p>
          )}
          {r.footnote && <p className="mt-2 border-l-2 border-gray-200 pl-2 text-xs text-gray-500">{r.footnote}</p>}
        </li>
      ))}
    </ul>
  )
}
