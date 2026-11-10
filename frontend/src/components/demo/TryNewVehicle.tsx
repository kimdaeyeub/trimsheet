import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DemoStatus } from '@shared/types'
import { CheckCircle2, CircleAlert, FlaskConical, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { qk } from '../../lib/query'
import { Button, IconButton } from '../ui/Button'
import { ErrorNotice } from '../ui/ErrorNotice'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Spinner'

const DONE = new Set(['finalized', 'skipped', 'failed', 'timeout'])
const STEPS: { stage: string; label: string }[] = [
  { stage: 'starting', label: '가격표 받기' },
  { stage: 'prepared', label: 'PDF 분석' },
  { stage: 'pass_a_done', label: '1차 추출' },
  { stage: 'pass_b_done', label: '2차 추출·검증' },
  { stage: 'finalized', label: '시트에 저장' },
]
const DISMISSED_KEY = 'trimsheet.demo.dismissed'

const isRunning = (s: DemoStatus | undefined) => Boolean(s?.run) && !DONE.has(s!.stage) && s!.stage !== 'idle'

/** Header button + confirm dialog. Progress is shown by <TryNewVehicleStatus />. */
export function TryNewVehicleButton() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const status = useQuery({ queryKey: qk.demo, queryFn: api.demoStatus })
  const start = useMutation({
    mutationFn: api.startDemo,
    onSuccess: async () => {
      localStorage.removeItem(DISMISSED_KEY)
      setOpen(false)
      await queryClient.invalidateQueries({ queryKey: qk.demo })
    },
  })
  const running = isRunning(status.data)

  return (
    <>
      <Button
        size="sm"
        onClick={() => (start.reset(), setOpen(true))}
        disabled={running}
        aria-haspopup="dialog"
        aria-label="새 차종 테스트"
        title={running ? '테스트가 진행 중입니다' : undefined}
        className="whitespace-nowrap"
      >
        {running ? <Spinner className="size-3.5" /> : <FlaskConical className="size-3.5" aria-hidden />}
        <span className="sm:hidden">테스트</span>
        <span className="hidden sm:inline">새 차종 테스트</span>
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="새 차종으로 테스트하기">
        <div className="flex flex-col gap-4 text-sm text-gray-700">
          <p>제네시스 홈페이지에서 <strong>시트에 아직 없는 차종 하나</strong>를 골라 가격표 PDF를 받고, 에이전트가 처음부터 끝까지 정리합니다.</p>
          <ul className="list-disc space-y-1 pl-5 text-gray-600">
            <li>보통 3~10분 걸립니다. 이 창을 닫아도 계속 진행되고, 화면 왼쪽에서 진행 상황을 볼 수 있습니다.</li>
            <li>AI(Workers AI)를 실제로 호출해 <strong>소액의 Cloudflare 비용</strong>이 듭니다(차종 1개당 약 10회 호출).</li>
            <li>끝나면 결과가 구글 시트와 이 화면에 추가되고, 이메일 알림에 등록한 주소로 메일이 갑니다.</li>
            <li>제네시스만 고르는 이유: 현대·기아 목록은 유료 브라우저(Browser Run)가 필요해서입니다.</li>
          </ul>
          {start.isError && <ErrorNotice error={start.error} />}
          <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button onClick={() => start.mutate()} disabled={start.isPending}>
              {start.isPending ? <Spinner /> : null}
              {start.isPending ? '가격표 받는 중…' : '테스트 시작'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

/** Progress card for the latest test run; polls while running, refreshes the list when done. */
export function TryNewVehicleStatus({ onOpen }: { onOpen: (jobId: string) => void }) {
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: qk.demo,
    queryFn: api.demoStatus,
    refetchInterval: (q) => (isRunning(q.state.data) ? 5000 : false),
  })
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED_KEY))
  const s = status.data
  const done = s ? DONE.has(s.stage) : false

  // When a run finishes, re-read the sheet so the new vehicle appears in the list.
  const finishedId = s?.run && done ? s.run.conversationId : null
  useEffect(() => {
    if (!finishedId) return
    void api.catalog({ page: 1, pageSize: 1, brand: '', q: '', fresh: true }).then(() => queryClient.invalidateQueries({ queryKey: ['catalog'] }))
  }, [finishedId, queryClient])

  if (!s?.run || s.stage === 'idle' || dismissed === s.run.conversationId) return null

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, s.run!.conversationId)
    setDismissed(s.run!.conversationId)
  }
  const current = STEPS.findIndex((x) => x.stage === s.stage)
  const name = `${s.run.brand} ${s.run.vehicleName}`

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'rounded-[var(--radius-card)] border p-3 text-sm',
        s.stage === 'finalized' ? 'border-success-500/30 bg-success-50' : done ? 'border-warning-500/30 bg-warning-50' : 'border-primary-200 bg-primary-50',
      )}
    >
      <div className="flex items-start gap-2">
        {s.stage === 'finalized' ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-700" aria-hidden />
        ) : done ? (
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning-700" aria-hidden />
        ) : (
          <Spinner className="mt-0.5 size-4 shrink-0 text-primary-500" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900">
            {s.stage === 'finalized'
              ? `${name} 정리 완료`
              : s.stage === 'skipped'
                ? `${name}: 건너뜀`
                : s.stage === 'failed'
                  ? `${name}: 정리 실패`
                  : s.stage === 'timeout'
                    ? `${name}: 응답이 없습니다`
                    : `${name} 정리 중`}
          </p>
          {!done && (
            <ol className="mt-2 flex flex-wrap gap-1" aria-label="진행 단계">
              {STEPS.map((step, i) => (
                <li
                  key={step.stage}
                  aria-current={i === current + 1 ? 'step' : undefined}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs',
                    i <= current ? 'bg-primary-500 text-white' : i === current + 1 ? 'bg-white text-primary-700 ring-1 ring-primary-300' : 'bg-white/70 text-gray-400',
                  )}
                >
                  {step.label}
                </li>
              ))}
            </ol>
          )}
          {s.progress && !done && <p className="mt-1.5 text-xs text-gray-600">{s.progress}</p>}
          {s.error && done && <p className="mt-1 text-xs text-gray-700">{s.error}</p>}
          {s.stage === 'timeout' && <p className="mt-1 text-xs text-gray-700">20분 넘게 진행되지 않았습니다. 다시 테스트할 수 있습니다.</p>}
          {s.stage === 'finalized' && s.jobId && (
            <Button size="sm" className="mt-2" onClick={() => onOpen(s.jobId!)}>
              결과 보기
            </Button>
          )}
        </div>
        {done && (
          <IconButton label="닫기" onClick={dismiss} className="-mt-1 -mr-1 size-7">
            <X className="size-4" aria-hidden />
          </IconButton>
        )}
      </div>
    </div>
  )
}
