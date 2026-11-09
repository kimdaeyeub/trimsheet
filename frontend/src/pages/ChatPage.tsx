import { useFlueAgent, type FlueConversationMessage } from '@flue/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { Composer } from '../components/chat/Composer'
import { MessageItem } from '../components/chat/MessageItem'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Spinner } from '../components/ui/Spinner'
import { api } from '../lib/api'
import { withTokens } from '../lib/format'
import { qk } from '../lib/query'
import type { PendingMessage } from './HomePage'

const finishedFinalizeIds = (messages: FlueConversationMessage[]) =>
  messages.flatMap((m) =>
    m.parts.flatMap((p) => (p.type === 'dynamic-tool' && p.toolName === 'finalize_job' && p.state === 'output-available' ? [p.toolCallId] : [])),
  )

export function ChatPage() {
  const { conversationId = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const agent = useFlueAgent({ url: `/api/agents/trimsheet/${conversationId}` })
  const conversations = useQuery({ queryKey: qk.conversations, queryFn: api.conversations })
  const conversation = conversations.data?.find((c) => c.id === conversationId)
  const bottom = useRef<HTMLDivElement>(null)
  const sentPending = useRef<string | null>(null)

  const visible = useMemo(() => agent.messages.filter((m) => m.display === 'visible' && m.role !== 'system'), [agent.messages])
  const busy = agent.status === 'submitted' || agent.status === 'streaming'

  const send = useCallback(
    async (text: string, file: File | null) => {
      const upload = file ? await api.upload(file) : null
      await agent.sendMessage(withTokens(text, { sourceId: upload?.sourceId, filename: upload?.filename, conversationId }))
      if (conversation && conversation.title === '새 작업') {
        void api.renameConversation(conversationId, (file?.name.replace(/\.pdf$/i, '') ?? text).slice(0, 30)).then(() =>
          qc.invalidateQueries({ queryKey: qk.conversations }),
        )
      }
    },
    [agent, conversation, conversationId, qc],
  )

  // First message handed over from the home page.
  useEffect(() => {
    const pending = (location.state as { pending?: PendingMessage } | null)?.pending
    if (!pending || !agent.historyReady || sentPending.current === conversationId) return
    sentPending.current = conversationId
    navigate(location.pathname, { replace: true, state: null })
    void agent.sendMessage(withTokens(pending.text, { sourceId: pending.sourceId, filename: pending.filename, conversationId }))
  }, [agent, agent.historyReady, conversationId, location.pathname, location.state, navigate])

  // When a job finishes, refresh lists that depend on it.
  const finalized = finishedFinalizeIds(agent.messages).join(',')
  useEffect(() => {
    if (!finalized) return
    qc.invalidateQueries({ queryKey: ['jobs'] })
    qc.invalidateQueries({ queryKey: qk.notifications })
  }, [finalized, qc])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [visible.length, agent.status])

  const force = () => void send('그래도 정리해 줘', null)

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6" aria-live="polite">
          {conversation && <h1 className="truncate text-sm font-medium text-gray-500">{conversation.title}</h1>}
          {!agent.historyReady && agent.status !== 'error' && (
            <div className="flex justify-center py-16 text-gray-400">
              <Spinner className="size-5" />
            </div>
          )}
          {agent.historyReady && visible.length === 0 && !busy && (
            <EmptyState icon={<MessageSquare className="size-10" />} title="새 대화">
              가격표 PDF를 올리거나 제조사 PDF 링크를 붙여 넣으세요.
            </EmptyState>
          )}
          {visible.map((m) => (
            <MessageItem key={m.id} message={m} onForce={busy ? undefined : force} onSend={busy ? undefined : (t) => void send(t, null)} />
          ))}
          {agent.status === 'submitted' && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Spinner className="size-3.5 text-primary-500" /> 에이전트가 읽는 중…
            </div>
          )}
          {agent.failedSends.length > 0 && (
            <p className="text-sm text-danger-700" role="alert">
              메시지 {agent.failedSends.length}건을 보내지 못했습니다: {agent.failedSends[0].error.message}
            </p>
          )}
          <div ref={bottom} />
        </div>
      </div>

      <div className="shrink-0 border-t border-gray-200 bg-canvas/80 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-3xl space-y-2">
          {agent.status === 'connecting' && <p className="text-sm text-gray-500">연결 중…</p>}
          {agent.status === 'error' && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">
              {agent.error?.message ?? '에이전트와 연결이 끊어졌습니다.'}
              <Button size="sm" variant="secondary" onClick={agent.refresh}>
                다시 시도
              </Button>
            </div>
          )}
          <Composer onSubmit={send} busy={busy} busyLabel="에이전트가 작업 중…" />
        </div>
      </div>
    </div>
  )
}
