import { useQueryClient } from '@tanstack/react-query'
import { FileUp, Link2, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Composer } from '../components/chat/Composer'
import { api } from '../lib/api'
import { qk } from '../lib/query'

export interface PendingMessage {
  text: string
  sourceId?: string
  filename?: string
}

const EXAMPLES = [
  { icon: Sparkles, text: '현대 더 뉴 스타리아 Electric 가격표 정리해 줘' },
  { icon: Link2, text: 'https://www.hyundai.com/... 가격표 PDF 링크를 정리해 줘' },
  { icon: FileUp, text: 'PDF를 끌어다 놓으면 바로 정리합니다' },
]

export function HomePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const start = async (text: string, file: File | null) => {
    const upload = file ? await api.upload(file) : null
    const title = (file?.name.replace(/\.pdf$/i, '') ?? text).slice(0, 30)
    const conv = await api.createConversation(title)
    qc.invalidateQueries({ queryKey: qk.conversations })
    const pending: PendingMessage = { text, sourceId: upload?.sourceId, filename: upload?.filename }
    navigate(`/c/${conv.id}`, { state: { pending } })
  }

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-4 py-12">
      <h1 className="text-center text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">어떤 가격표를 정리할까요?</h1>
      <p className="mt-2 text-center text-gray-500">
        현대·기아·제네시스 가격표 PDF에서 트림·색상·선택 품목·옵션 규칙을 뽑아 Google Sheets에 올립니다.
      </p>
      <div className="mt-8">
        <Composer onSubmit={start} autoFocus large busyLabel="준비 중…" />
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-3">
        {EXAMPLES.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-2 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-600">
            <Icon className="mt-0.5 size-4 shrink-0 text-primary-500" aria-hidden /> {text}
          </li>
        ))}
      </ul>
    </div>
  )
}
