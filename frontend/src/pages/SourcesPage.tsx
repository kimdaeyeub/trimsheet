import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Play, Radar } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { VehicleRow } from '@shared/types'
import { Badge, type Tone } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { Spinner } from '../components/ui/Spinner'
import { api } from '../lib/api'
import { cn } from '../lib/cn'
import { formatKst } from '../lib/format'
import { qk } from '../lib/query'

const STATUS_TONE: Record<string, Tone> = {
  '처리 완료': 'success',
  '처리 중': 'primary',
  기준선: 'neutral',
  '갱신 후보': 'warning',
  보류: 'warning',
  '이전 연식': 'neutral',
}
const FILTERS = ['전체', '보류', '갱신 후보', '기준선', '처리 완료', '이전 연식'] as const
const BRANDS = ['전체', '현대', '기아', '제네시스'] as const

export function SourcesPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('전체')
  const [brand, setBrand] = useState<(typeof BRANDS)[number]>('전체')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState<string | null>(null)
  const vehicles = useQuery({ queryKey: qk.vehicles, queryFn: api.vehicles })
  const scans = useQuery({ queryKey: qk.scanRuns, queryFn: api.scanRuns })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.vehicles })
    void qc.invalidateQueries({ queryKey: qk.scanRuns })
    void qc.invalidateQueries({ queryKey: qk.conversations })
  }
  const scan = useMutation({
    mutationFn: api.startScan,
    onSuccess: (r) => {
      setMessage(
        r.mode === 'baseline'
          ? '첫 확인을 시작했습니다. 현재 판매 중인 차량을 기준선으로 등록만 하고 정리는 하지 않습니다. 몇 분 걸릴 수 있습니다.'
          : '확인을 시작했습니다. 새 가격표가 있으면 작업이 자동으로 시작되고 알림이 옵니다.',
      )
      refresh()
    },
  })
  const processMany = useMutation({
    mutationFn: async (keys: string[]) => {
      const results = []
      for (const k of keys) results.push(await api.processVehicle(k))
      return results
    },
    onSuccess: (results) => {
      setSelected(new Set())
      refresh()
      if (results.length === 1) navigate(`/c/${results[0].conversationId}`)
      else setMessage(`${results.length}대의 정리를 시작했습니다. 왼쪽 대화 목록에서 진행 상황을 볼 수 있습니다.`)
    },
  })
  const dismiss = useMutation({ mutationFn: api.dismissVehicle, onSuccess: refresh })

  const rows = useMemo(
    () => (vehicles.data ?? []).filter((v) => (filter === '전체' || v.status === filter) && (brand === '전체' || v.brand === brand)),
    [vehicles.data, filter, brand],
  )
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const v of vehicles.data ?? []) c[v.status] = (c[v.status] ?? 0) + 1
    return c
  }, [vehicles.data])
  const lastRun = scans.data?.runs[0]
  const processable = (v: VehicleRow) => Boolean(v.sourceId) && ['기준선', '보류', '갱신 후보'].includes(v.status)
  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else if (n.size < 10) n.add(key)
      return n
    })

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">수집 현황</h1>
          <p className="mt-1 text-sm text-gray-500">
            {scans.data?.schedule ?? '매주 월요일 09:00 (KST)'} 자동 확인 · 마지막 확인{' '}
            {lastRun ? `${formatKst(lastRun.startedAt)} (${lastRun.mode}${lastRun.finishedAt ? '' : ', 진행 중'})` : '없음'}
          </p>
        </div>
        <Button onClick={() => scan.mutate()} disabled={scan.isPending}>
          {scan.isPending ? <Spinner className="size-4" /> : <Play className="size-4" aria-hidden />} 지금 확인
        </Button>
      </div>

      {scans.data && !scans.data.baselineDone && (
        <div className="rounded-lg border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-800">
          첫 확인에서는 현대·기아·제네시스 홈페이지의 <strong>현재 판매 차량 최신 가격표를 기준선으로 등록만</strong> 하고 정리(AI 처리)는 하지 않습니다.
          이후 확인부터 신차·새 연식·새 가격표만 자동으로 정리합니다. 기준선 차량은 아래에서 골라 바로 정리할 수 있습니다.
        </div>
      )}
      {message && (
        <p role="status" className="rounded-lg bg-white px-4 py-3 text-sm text-gray-700 shadow-sm ring-1 ring-gray-200">
          {message}
        </p>
      )}
      {lastRun?.failures && (
        <div className="flex gap-2 rounded-lg border border-warning-500/30 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">최근 확인에서 수집하지 못한 항목</p>
            <p className="mt-1 whitespace-pre-line">{lastRun.failures}</p>
          </div>
        </div>
      )}
      {(scan.error || processMany.error || dismiss.error) && <ErrorNotice error={scan.error ?? processMany.error ?? dismiss.error} />}

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="상태" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn('rounded-full px-3 py-1 text-sm', filter === f ? 'bg-primary-500 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50')}
            >
              {f}
              {f !== '전체' && counts[f] ? <span className="ml-1 opacity-70">{counts[f]}</span> : null}
            </button>
          ))}
        </div>
        <select aria-label="브랜드" value={brand} onChange={(e) => setBrand(e.target.value as (typeof BRANDS)[number])} className="ml-auto rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm">
          {BRANDS.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        {selected.size > 0 && (
          <Button size="sm" onClick={() => processMany.mutate([...selected])} disabled={processMany.isPending}>
            선택한 {selected.size}대 정리하기
          </Button>
        )}
      </div>

      {vehicles.isError && <ErrorNotice error={vehicles.error} onRetry={() => vehicles.refetch()} />}
      {vehicles.isLoading && (
        <div className="flex justify-center py-16 text-gray-400">
          <Spinner className="size-5" />
        </div>
      )}
      {vehicles.data && rows.length === 0 && (
        <Card>
          <EmptyState icon={<Radar className="size-10" />} title={vehicles.data.length ? '조건에 맞는 차량이 없습니다' : '아직 수집한 차량이 없습니다'}>
            {!vehicles.data.length && '"지금 확인"을 누르면 세 브랜드 홈페이지에서 현재 판매 차량의 가격표를 확인합니다.'}
          </EmptyState>
        </Card>
      )}
      {rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 text-left text-xs text-gray-500">
              <tr>
                <th className="w-10 px-3 py-3">
                  <span className="sr-only">선택</span>
                </th>
                <th className="px-3 py-3 font-medium">차종</th>
                <th className="px-3 py-3 font-medium">연식</th>
                <th className="px-3 py-3 font-medium">기준일</th>
                <th className="px-3 py-3 font-medium">상태</th>
                <th className="px-3 py-3 font-medium">판정 사유</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((v) => (
                <tr key={v.vehicleKey} className={cn('hover:bg-gray-50', v.status === '이전 연식' && 'text-gray-400')}>
                  <td className="px-3 py-2.5">
                    {processable(v) && (
                      <input type="checkbox" aria-label={`${v.vehicleName} 선택`} checked={selected.has(v.vehicleKey)} onChange={() => toggle(v.vehicleKey)} className="size-4 accent-[var(--color-primary-500)]" />
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-gray-900">{v.vehicleName}</span>
                    <span className="block text-xs text-gray-400">{v.brand}</span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{v.modelYear || '—'}</td>
                  <td className="px-3 py-2.5 text-xs tabular-nums">{v.effectiveDate || '—'}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={STATUS_TONE[v.status] ?? 'neutral'}>{v.status}</Badge>
                  </td>
                  <td className="max-w-xs px-3 py-2.5 text-xs text-gray-500">{v.reason}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {v.lastJobId && (
                      <Link to={`/jobs/${v.lastJobId}`} className="mr-2 text-xs text-primary-600 hover:underline">
                        결과 보기
                      </Link>
                    )}
                    {processable(v) && (
                      <>
                        <Button size="sm" variant="secondary" disabled={processMany.isPending} onClick={() => processMany.mutate([v.vehicleKey])}>
                          정리
                        </Button>
                        {v.status !== '기준선' && (
                          <Button size="sm" variant="ghost" disabled={dismiss.isPending} onClick={() => dismiss.mutate(v.vehicleKey)}>
                            무시
                          </Button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
