import type { CatalogSummary } from '@shared/types'
import { ChevronRight } from 'lucide-react'
import { formatPriceRange } from '../../lib/format'
import { cn } from '../../lib/cn'
import { BrandMark } from './BrandMark'

export function VehicleCard({ vehicle: v, selected, onSelect }: { vehicle: CatalogSummary; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'group flex w-full items-center gap-3 rounded-[var(--radius-card)] border bg-white p-3 text-left transition-colors',
        selected ? 'border-primary-500 ring-2 ring-primary-100' : 'border-gray-200 hover:border-primary-200 hover:bg-primary-50/30',
      )}
    >
      <BrandMark brand={v.brand} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold text-gray-900">{v.vehicleName}</p>
          {v.modelYear && <span className="shrink-0 text-xs text-gray-500">{v.modelYear}년</span>}
        </div>
        <p className="mt-0.5 text-sm font-medium text-primary-600 tabular-nums">{formatPriceRange(v.priceFrom, v.priceTo)}</p>
        <p className="mt-1 text-xs text-gray-500">
          트림 {v.trimCount} · 옵션 {v.optionCount} · 색상 {v.colorCount} · 규칙 {v.ruleCount}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <ChevronRight className={cn('size-4 text-gray-300 group-hover:text-primary-400', selected && 'text-primary-500')} aria-hidden />
      </div>
    </button>
  )
}
