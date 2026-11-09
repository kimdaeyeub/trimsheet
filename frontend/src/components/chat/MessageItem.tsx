import type { FlueConversationMessage, FlueConversationPart } from '@flue/react'
import { ChevronRight, FileText } from 'lucide-react'
import { cn } from '../../lib/cn'
import { stripTokens } from '../../lib/format'
import { Markdown } from './Markdown'
import { ExtractPassCard, FinalizeJobCard, GenericToolCard, PrepareSourceCard, RegisterPdfCard } from './tool-cards/ToolCards'
import type { ToolPart } from './tool-cards/shared'

type DynamicTool = Extract<FlueConversationPart, { type: 'dynamic-tool' }>

function toolPart(p: DynamicTool): ToolPart {
  return {
    toolName: p.toolName,
    toolCallId: p.toolCallId,
    state: p.state,
    input: p.input,
    output: p.state === 'output-available' ? p.output : undefined,
    errorText: p.state === 'output-error' ? p.errorText : undefined,
  }
}

function ToolCard({ part, onForce }: { part: ToolPart; onForce?: () => void }) {
  switch (part.toolName) {
    case 'register_pdf_url':
      return <RegisterPdfCard part={part} />
    case 'prepare_source':
      return <PrepareSourceCard part={part} onForce={onForce} />
    case 'extract_pass':
      return <ExtractPassCard part={part} onForce={onForce} />
    case 'finalize_job':
      return <FinalizeJobCard part={part} />
    default:
      return <GenericToolCard part={part} />
  }
}

function UserBubble({ text }: { text: string }) {
  const { text: body, file, source } = stripTokens(text)
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-2 rounded-2xl rounded-br-md bg-primary-500 px-4 py-2.5 text-white">
        {(file || source) && (
          <span className="flex items-center gap-2 rounded-lg bg-white/15 px-2.5 py-1.5 text-sm">
            <FileText className="size-4" aria-hidden /> {file ?? 'PDF 첨부'}
          </span>
        )}
        {body && <p className="whitespace-pre-wrap">{body}</p>}
      </div>
    </div>
  )
}

export function MessageItem({ message, onForce }: { message: FlueConversationMessage; onForce?: () => void }) {
  if (message.role === 'user') {
    const text = message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
    return <UserBubble text={text} />
  }
  return (
    <div className={cn('max-w-[92%] text-[15px] text-gray-900', message.settlement?.outcome === 'failed' && 'opacity-80')}>
      {message.parts.map((part, i) => {
        if (part.type === 'text') {
          return part.text.trim() ? (
            <div key={i} className="rounded-2xl rounded-bl-md border border-gray-200 bg-white px-4 py-3">
              <Markdown text={part.text} />
            </div>
          ) : null
        }
        if (part.type === 'reasoning') {
          return part.text.trim() ? (
            <details key={i} className="group my-1 text-sm text-gray-500">
              <summary className="flex cursor-pointer list-none items-center gap-1 select-none hover:text-gray-700">
                <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden /> 생각 과정
              </summary>
              <p className="mt-1 border-l-2 border-gray-200 pl-3 whitespace-pre-wrap">{part.text}</p>
            </details>
          ) : null
        }
        if (part.type === 'dynamic-tool') return <ToolCard key={part.toolCallId} part={toolPart(part)} onForce={onForce} />
        if (part.type === 'file') {
          return (
            <a key={i} href={part.url} target="_blank" rel="noreferrer" className="my-1 inline-flex items-center gap-2 text-sm text-primary-600 underline">
              <FileText className="size-4" aria-hidden /> {part.filename ?? '첨부 파일'}
            </a>
          )
        }
        return null
      })}
      {message.settlement?.outcome === 'failed' && <p className="mt-1 text-sm text-danger-700">응답 처리 중 오류가 발생했습니다.</p>}
    </div>
  )
}
