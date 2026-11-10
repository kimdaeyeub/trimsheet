import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CarFront, RefreshCw, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { qk } from '../../lib/query'
import { useUrlState } from '../../lib/url-state'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { ErrorNotice } from '../ui/ErrorNotice'
import { Spinner } from '../ui/Spinner'
import { TryNewVehicleStatus } from '../demo/TryNewVehicle'
import { Pagination } from './Pagination'
import { VehicleCard } from './VehicleCard'
import { VehicleDetail } from './VehicleDetail'

const PAGE_SIZE = 10
const BRANDS = ['현대', '기아', '제네시스']

export function VehicleBrowser() {
  const [state, set] = useUrlState()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState(state.q)
  const [refreshing, setRefreshing] = useState(false)

  // Follow the URL when it changes from outside the box (Back/Forward, brand link).
  const [syncedQ, setSyncedQ] = useState(state.q)
  if (state.q !== syncedQ) {
    setSyncedQ(state.q)
    setSearch(state.q)
  }

  // Debounce typing into the URL (replace, so each keystroke is not a history entry).
  useEffect(() => {
    if (search.trim() === state.q) return
    const t = setTimeout(() => set({ q: search.trim(), page: 1 }, { replace: true }), 250)
    return () => clearTimeout(t)
  }, [search, state.q, set])

  const list = useQuery({
    queryKey: qk.catalog(state.page, PAGE_SIZE, state.brand, state.q),
    queryFn: () => api.catalog({ page: state.page, pageSize: PAGE_SIZE, brand: state.brand, q: state.q }),
    placeholderData: keepPreviousData,
  })
  const data = list.data

  // Keep the URL's page in range (e.g. after a filter shrinks the list).
  // Ignore placeholder data: it still belongs to the previous page while the new one loads.
  const settled = data && !list.isPlaceholderData ? data : null
  useEffect(() => {
    if (settled && state.page > settled.totalPages) set({ page: settled.totalPages }, { replace: true })
  }, [settled, state.page, set])

  async function refresh() {
    setRefreshing(true)
    try {
      // fresh=1 skips the backend's 30-second cache; then refetch everything shown.
      await api.catalog({ page: 1, pageSize: 1, brand: '', q: '', fresh: true })
      await queryClient.invalidateQueries({ queryKey: ['catalog'] })
      await queryClient.invalidateQueries({ queryKey: ['vehicle'] })
    } finally {
      setRefreshing(false)
    }
  }

  const total = data ? Object.values(data.brands).reduce((a, b) => a + b, 0) : 0
  const brandTabs = [{ label: '전체', value: '', count: total }, ...BRANDS.map((b) => ({ label: b, value: b, count: data?.brands[b] ?? 0 }))]

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      {/* List: hidden on small screens while a vehicle is open */}
      <section aria-label="차종 목록" className={cn('flex flex-col gap-4', state.v && 'hidden lg:flex')}>
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">차종별 가격 정보</h1>
            <p className="mt-0.5 text-sm text-gray-500">{data ? `${data.total}개 차종` : ' '}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={refresh} disabled={refreshing} aria-label="시트에서 다시 불러오기">
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} aria-hidden />
            새로고침
          </Button>
        </div>

        <TryNewVehicleStatus onOpen={(id) => set({ v: id })} />

        <label className="relative block">
          <span className="sr-only">차종 검색</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-gray-400" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="차종 검색 (예: 쏘렌토, G80)"
            className="h-10 w-full rounded-lg border border-gray-200 bg-white pr-3 pl-9 text-sm outline-none placeholder:text-gray-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
          />
        </label>

        <div role="tablist" aria-label="브랜드" className="flex flex-wrap gap-1.5">
          {brandTabs.map((t) => {
            const active = state.brand === t.value
            return (
              <button
                key={t.label}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => set({ brand: t.value, page: 1 })}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors',
                  active ? 'border-primary-500 bg-primary-500 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
                )}
              >
                {t.label}
                <span className={cn('text-xs tabular-nums', active ? 'text-primary-100' : 'text-gray-400')}>{t.count}</span>
              </button>
            )
          })}
        </div>

        {list.isError && <ErrorNotice error={list.error} onRetry={() => list.refetch()} />}
        {list.isPending && (
          <div className="flex justify-center py-16 text-primary-500">
            <Spinner className="size-6" />
          </div>
        )}
        {data && data.items.length === 0 && (
          <EmptyState icon={<CarFront className="size-10" />} title={state.q || state.brand ? '조건에 맞는 차종이 없습니다' : '아직 정리된 차종이 없습니다'}>
            {state.q || state.brand
              ? '검색어나 브랜드를 바꿔 보세요.'
              : '에이전트가 가격표 PDF를 정리하면 구글 시트에 저장되고, 여기에 차종별로 나타납니다.'}
          </EmptyState>
        )}
        {data && data.items.length > 0 && (
          <ul className={cn('flex flex-col gap-2 transition-opacity', list.isPlaceholderData && 'opacity-60')}>
            {data.items.map((v) => (
              <li key={v.id}>
                <VehicleCard vehicle={v} selected={v.id === state.v} onSelect={() => set({ v: v.id })} />
              </li>
            ))}
          </ul>
        )}
        {data && data.totalPages > 1 && <Pagination page={data.page} totalPages={data.totalPages} onChange={(page) => set({ page })} />}
      </section>

      <section aria-label="차종 상세" className={cn('min-w-0', !state.v && 'hidden lg:block')}>
        {state.v ? (
          <>
            <Button variant="ghost" size="sm" className="mb-3 -ml-2 lg:hidden" onClick={() => set({ v: '' })}>
              <ArrowLeft className="size-4" aria-hidden />
              목록으로
            </Button>
            <VehicleDetail id={state.v} />
          </>
        ) : (
          <div className="rounded-[var(--radius-card)] border border-dashed border-gray-300 bg-white/50">
            <EmptyState icon={<CarFront className="size-10" />} title="왼쪽 목록에서 차종을 고르세요">
              트림·선택 품목·색상·옵션 규칙을 한 화면에서 볼 수 있습니다.
            </EmptyState>
          </div>
        )}
      </section>
    </div>
  )
}
