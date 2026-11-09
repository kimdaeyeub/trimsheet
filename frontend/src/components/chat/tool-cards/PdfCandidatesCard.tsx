import { FileText } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { type ToolPart, ToolShell } from './shared'
import { asRecord, str } from './util'

interface Candidate {
  url: string
  label: string
  guessKind: 'pricesheet' | 'catalog' | 'unknown'
  modelYear: string | null
  alreadyKnown?: boolean
}

const KIND = { pricesheet: '가격표', catalog: '카탈로그', unknown: 'PDF' } as const

export function PdfCandidatesCard({ part, onSend }: { part: ToolPart; onSend?: (text: string) => void }) {
  const out = asRecord(part.output)
  const candidates = (Array.isArray(out.candidates) ? out.candidates : []) as Candidate[]
  const dropped = (Array.isArray(out.dropped) ? out.dropped : []) as { url: string; reason: string }[]
  const failure = str(out.failure)
  return (
    <ToolShell part={part} tone={failure ? 'warning' : 'normal'} title={failure ? `PDF를 찾지 못했습니다 (${failure})` : `PDF 후보 ${candidates.length}개`}>
      {part.state === 'output-available' && (
        <div className="space-y-2">
          {failure && <p>PDF를 직접 올려 주시면 바로 정리합니다.</p>}
          <ul className="divide-y divide-gray-100">
            {candidates.map((c) => (
              <li key={c.url} className="flex items-center gap-2 py-2">
                <FileText className="size-4 shrink-0 text-gray-400" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{c.label}</span>
                  <span className="flex flex-wrap gap-1 pt-0.5">
                    <Badge tone={c.guessKind === 'pricesheet' ? 'primary' : 'neutral'}>{KIND[c.guessKind]}</Badge>
                    {c.modelYear && <Badge>{c.modelYear}년형</Badge>}
                    {c.alreadyKnown && <Badge tone="warning">이전에 받은 파일</Badge>}
                  </span>
                </span>
                {onSend && c.guessKind !== 'catalog' && (
                  <Button size="sm" variant="secondary" onClick={() => onSend(`이 PDF를 정리해 줘: ${c.url}`)}>
                    이 PDF 정리하기
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {dropped.length > 0 && (
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer">제외한 링크 {dropped.length}개</summary>
              <ul className="mt-1 space-y-0.5">
                {dropped.map((d) => (
                  <li key={d.url} className="truncate">
                    {d.reason} · {d.url}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </ToolShell>
  )
}
