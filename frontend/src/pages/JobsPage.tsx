import { useQuery } from '@tanstack/react-query'
import { ExternalLink, LayoutList } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { Spinner } from '../components/ui/Spinner'
import { api } from '../lib/api'
import { formatKst } from '../lib/format'
import { jobStatus, modelLabel } from '../lib/labels'
import { qk } from '../lib/query'

export function JobsPage() {
  const jobs = useQuery({ queryKey: qk.jobs(), queryFn: () => api.jobs() })
  const settings = useQuery({ queryKey: qk.settings, queryFn: api.settings, staleTime: 5 * 60_000 })

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-4 text-xl font-bold">작업 결과</h1>
      {jobs.isError && <ErrorNotice error={jobs.error} onRetry={() => jobs.refetch()} />}
      {jobs.isLoading && (
        <div className="flex justify-center py-16 text-gray-400">
          <Spinner className="size-5" />
        </div>
      )}
      {jobs.data?.length === 0 && (
        <Card>
          <EmptyState icon={<LayoutList className="size-10" />} title="아직 작업이 없습니다">
            새 작업에서 가격표 PDF를 올리면 여기에 결과가 쌓입니다.
          </EmptyState>
        </Card>
      )}
      {jobs.data && jobs.data.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">차종</th>
                <th className="px-4 py-3 font-medium">상태</th>
                <th className="px-4 py-3 text-right font-medium">확인 필요</th>
                <th className="px-4 py-3 font-medium">모델</th>
                <th className="px-4 py-3 font-medium">생성</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {jobs.data.map((j) => {
                const s = jobStatus(j)
                return (
                  <tr key={j.jobId} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link to={`/jobs/${j.jobId}`} className="font-medium text-gray-900 hover:text-primary-600">
                        {j.vehicleName || j.filename || j.jobId}
                      </Link>
                      <span className="block text-xs text-gray-400">
                        {[j.brand, j.modelYear && `${j.modelYear}년형`, j.effectiveDate && `${j.effectiveDate} 기준`].filter(Boolean).join(' · ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {j.reviewCount ? <span className={Number(j.reviewCount) > 0 ? 'font-semibold text-warning-700' : ''}>{j.reviewCount}</span> : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{modelLabel(j.modelA)}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap text-gray-500">{formatKst(j.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {settings.data?.spreadsheetUrl && j.stage === 'finalized' && (
                        <a href={settings.data.spreadsheetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline">
                          시트 <ExternalLink className="size-3" aria-hidden />
                        </a>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
