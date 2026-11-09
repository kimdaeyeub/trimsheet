import { Radar } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'

export function SourcesPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-4 text-xl font-bold">수집 현황</h1>
      <Card>
        <EmptyState icon={<Radar className="size-10" />} title="준비 중입니다">
          현대·기아·제네시스 홈페이지 자동 확인과 차량별 수집 현황은 Phase 6에서 추가됩니다. 지금은 새 작업에서 PDF를 직접 올려 주세요.
        </EmptyState>
      </Card>
    </div>
  )
}
