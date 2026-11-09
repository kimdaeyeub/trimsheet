import { ExternalLink, FileText } from 'lucide-react'
import { Link } from 'react-router'
import { modelLabel } from '../../../lib/labels'
import { Badge } from '../../ui/Badge'
import { buttonClass } from '../../ui/button-styles'
import { type ToolPart, ToolShell } from './shared'
import { asRecord, str, useJobProgress } from './util'
import { SkippedCard } from './SkippedCard'

const pagesText = (pages: unknown) => (Array.isArray(pages) && pages.length ? pages.map((p) => `p.${p}`).join(', ') : '—')

function Counts({ counts }: { counts: Record<string, unknown> }) {
  const items: [string, unknown][] = [
    ['트림', counts.trims],
    ['색상', counts.colors],
    ['선택 품목', counts.options],
    ['규칙', counts.rules],
  ]
  return (
    <dl className="grid grid-cols-4 gap-2 text-center">
      {items.map(([label, n]) => (
        <div key={label} className="rounded-lg bg-gray-50 py-2">
          <dt className="text-xs text-gray-500">{label}</dt>
          <dd className="text-lg font-semibold text-gray-900">{str(n) || '0'}</dd>
        </div>
      ))}
    </dl>
  )
}

export function RegisterPdfCard({ part }: { part: ToolPart }) {
  const out = asRecord(part.output)
  return (
    <ToolShell part={part}>
      {part.state === 'output-available' && (
        <p className="flex items-center gap-2">
          <FileText className="size-4 text-gray-400" aria-hidden />
          {str(out.filename)}
          {out.alreadyKnown === true && <Badge>이전에 받은 파일</Badge>}
        </p>
      )}
    </ToolShell>
  )
}

export function PrepareSourceCard({ part, onForce }: { part: ToolPart; onForce?: () => void }) {
  const out = asRecord(part.output)
  if (out.skipped === true) return <SkippedCard part={part} output={out} onForce={onForce} />
  const vehicle = asRecord(out.vehicle)
  const map = asRecord(out.pageMap)
  return (
    <ToolShell part={part} tone={out.isScanned ? 'warning' : 'normal'}>
      {part.state === 'output-available' && (
        <div className="space-y-1">
          <p>
            {str(out.pageCount)}페이지 · 가격 {pagesText(map.price)} · 색상 {pagesText(map.color)} · 선택 품목 {pagesText(map.option)}
          </p>
          {(str(vehicle.name) || str(vehicle.modelYear)) && (
            <p className="text-gray-500">
              인식: {str(vehicle.name) || '차종 미확인'} {str(vehicle.modelYear) && `${str(vehicle.modelYear)}년형`}
            </p>
          )}
          {out.isScanned === true && <p className="text-warning-700">스캔본으로 보입니다. 모든 항목을 확인 필요로 분류합니다.</p>}
          {out.looksLikePriceSheet === false && <p className="text-warning-700">가격표처럼 보이지 않습니다. 추출 결과로 다시 확인합니다.</p>}
          {str(out.plannedModel) && <Badge tone="primary">{modelLabel(str(out.plannedModel))}</Badge>}
        </div>
      )}
    </ToolShell>
  )
}

export function ExtractPassCard({ part, onForce }: { part: ToolPart; onForce?: () => void }) {
  const input = asRecord(part.input)
  const out = asRecord(part.output)
  const running = part.state === 'input-available'
  const progress = useJobProgress(str(input.jobId) || undefined, running)
  const title = input.pass === 'B' ? '2차 추출 (교차검증)' : '1차 추출'
  if (out.skipped === true) return <SkippedCard part={part} output={out} onForce={onForce} />
  const counts = asRecord(out.counts)
  return (
    <ToolShell part={part} title={title} progress={progress ?? (running ? '모델이 가격표를 읽는 중… (수 분 걸릴 수 있음)' : undefined)}>
      {part.state === 'output-available' && (
        <div className="space-y-2">
          {out.isPriceSheet === false ? (
            <p className="text-warning-700">가격표가 아닌 문서로 판단했습니다.</p>
          ) : (
            <p>
              트림 {str(counts.trims)} · 색상 {str(counts.colors)} · 선택 품목 {str(counts.options)} · 규칙 {str(counts.rules)}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={out.usedFallback ? 'warning' : 'primary'}>{modelLabel(str(out.model))}</Badge>
            {out.usedFallback === true && (
              <Badge tone="warning">
                <span title={(out.fallbackReasons as string[] | undefined)?.join('\n')}>OpenAI 폴백 사용</span>
              </Badge>
            )}
          </div>
        </div>
      )}
    </ToolShell>
  )
}

export function FinalizeJobCard({ part }: { part: ToolPart }) {
  const input = asRecord(part.input)
  const out = asRecord(part.output)
  const running = part.state === 'input-available'
  const progress = useJobProgress(str(input.jobId) || undefined, running)
  if (part.state === 'output-available' && out.isPriceSheet === false) {
    return (
      <ToolShell part={part} tone="warning" title="가격표가 아니어서 정리하지 않았습니다">
        {str(out.message)}
      </ToolShell>
    )
  }
  const counts = asRecord(out.counts)
  const vehicle = asRecord(out.vehicle)
  const review = Number(out.reviewCount ?? 0)
  return (
    <ToolShell part={part} tone="success" progress={progress} title={running ? '검증 · 시트 반영' : `${str(vehicle.name)} ${str(vehicle.modelYear)} 정리 완료`}>
      {part.state === 'output-available' && (
        <div className="space-y-3">
          <Counts counts={counts} />
          <div className="flex flex-wrap items-center gap-2">
            {review > 0 ? <Badge tone="warning">확인 필요 {review}건</Badge> : <Badge tone="success">확인 필요 없음</Badge>}
            {out.replacedPrevious === true && <Badge>이전 결과를 교체함</Badge>}
            {out.sheetsConfigured === false && <Badge tone="warning">Sheets 미연결 · 임시 저장</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to={str(out.jobUrl)} className={buttonClass('primary', 'sm')}>
              검토하기
            </Link>
            {str(out.sheetUrl) && (
              <a href={str(out.sheetUrl)} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'sm')}>
                Google Sheets에서 보기 <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </div>
        </div>
      )}
    </ToolShell>
  )
}

export function GenericToolCard({ part }: { part: ToolPart }) {
  return <ToolShell part={part} />
}
