import { useQuery } from '@tanstack/react-query'
import type { CatalogDetail } from '@shared/types'
import { ExternalLink, FileText } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatKstDate, formatPriceRange } from '../../lib/format'
import { qk } from '../../lib/query'
import { buttonClass } from '../ui/button-styles'
import { Card } from '../ui/Card'
import { ErrorNotice } from '../ui/ErrorNotice'
import { Spinner } from '../ui/Spinner'
import { BrandMark } from './BrandMark'
import { PdfUrlContext } from './pdf-context'
import { ColorsSection, OptionsSection, RulesSection, TrimsSection } from './sections'

type Tab = 'trims' | 'options' | 'colors' | 'rules'

export function VehicleDetail({ id }: { id: string }) {
  const q = useQuery({ queryKey: qk.vehicle(id), queryFn: () => api.vehicle(id) })
  if (q.isPending)
    return (
      <Card className="flex justify-center py-24 text-primary-500">
        <Spinner className="size-6" />
      </Card>
    )
  if (q.isError) return <ErrorNotice error={q.error} onRetry={() => q.refetch()} />
  // Remount per vehicle so the active tab resets.
  return <Detail key={id} v={q.data} />
}

function Detail({ v }: { v: CatalogDetail }) {
  const [tab, setTab] = useState<Tab>('trims')
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'trims', label: '트림', count: v.trimCount },
    { key: 'options', label: '선택 품목', count: v.optionCount },
    { key: 'colors', label: '색상', count: v.colorCount },
    { key: 'rules', label: '옵션 규칙', count: v.ruleCount },
  ]
  const allTrims = v.trims.map((t) => t.name)

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-gray-100 p-5">
        <div className="flex flex-wrap items-start gap-4">
          <BrandMark brand={v.brand} className="size-12 text-base" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-gray-500">{v.brand}</p>
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">
              {v.vehicleName}
              {v.modelYear && <span className="ml-2 text-base font-medium text-gray-400">{v.modelYear}년</span>}
            </h2>
            <p className="mt-1 text-lg font-semibold text-primary-600 tabular-nums">{formatPriceRange(v.priceFrom, v.priceTo)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {v.pdfUrl && (
              <a href={v.pdfUrl} target="_blank" rel="noreferrer" className={buttonClass('primary', 'sm')}>
                <FileText className="size-3.5" aria-hidden />
                원문 PDF
              </a>
            )}
            {v.sourceUrl && (
              <a href={v.sourceUrl} target="_blank" rel="noreferrer" className={buttonClass('ghost', 'sm')}>
                제조사 원본
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </div>
        </div>
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {v.effectiveDate && (
            <div className="flex gap-1.5">
              <dt className="text-gray-500">가격표 기준일</dt>
              <dd className="font-medium text-gray-800">{v.effectiveDate.replaceAll('-', '.')}</dd>
            </div>
          )}
          {v.updatedAt && (
            <div className="flex gap-1.5">
              <dt className="text-gray-500">정리한 날</dt>
              <dd className="font-medium text-gray-800">{formatKstDate(v.updatedAt)}</dd>
            </div>
          )}
        </dl>
      </div>

      <div role="tablist" aria-label="정보 종류" className="flex gap-1 overflow-x-auto border-b border-gray-100 px-3 [scrollbar-width:none]">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            onClick={() => setTab(t.key)}
            className={cn(
              '-mb-px flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors',
              tab === t.key ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-800',
            )}
          >
            {t.label}
            <span className="rounded-full bg-gray-100 px-1.5 text-xs text-gray-500 tabular-nums">{t.count}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="p-5">
        <PdfUrlContext value={v.pdfUrl}>
          {tab === 'trims' && <TrimsSection trims={v.trims} />}
          {tab === 'options' && <OptionsSection options={v.options} allTrims={allTrims} />}
          {tab === 'colors' && <ColorsSection colors={v.colors} allTrims={allTrims} />}
          {tab === 'rules' && <RulesSection rules={v.rules} />}
        </PdfUrlContext>
      </div>
    </Card>
  )
}
