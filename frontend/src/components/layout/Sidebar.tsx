import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, FileSpreadsheet, LayoutList, MoreHorizontal, Pencil, Plus, Radar, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router'
import type { Conversation } from '@shared/types'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatKst } from '../../lib/format'
import { qk } from '../../lib/query'
import { IconButton } from '../ui/Button'
import { buttonClass } from '../ui/button-styles'
import { Spinner } from '../ui/Spinner'
import { Logo } from './Logo'

function ConversationItem({ conv, active, onNavigate }: { conv: Conversation; active: boolean; onNavigate: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(conv.title)

  const rename = useMutation({
    mutationFn: (t: string) => api.renameConversation(conv.id, t),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.conversations }),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteConversation(conv.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.conversations })
      if (active) navigate('/')
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = title.trim()
    setEditing(false)
    if (t && t !== conv.title) rename.mutate(t)
    else setTitle(conv.title)
  }

  if (editing) {
    return (
      <form onSubmit={submit} className="px-2 py-1">
        <input
          autoFocus
          aria-label="대화 제목"
          value={title}
          maxLength={100}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={submit}
          onKeyDown={(e) => e.key === 'Escape' && (setTitle(conv.title), setEditing(false))}
          className="w-full rounded-md border border-primary-300 bg-white px-2 py-1.5 text-sm outline-none"
        />
      </form>
    )
  }

  return (
    <div className="group relative">
      <Link
        to={`/c/${conv.id}`}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'block rounded-lg border-l-[3px] py-2 pr-9 pl-2.5 text-sm',
          active ? 'border-primary-500 bg-primary-50 text-primary-900' : 'border-transparent text-gray-700 hover:bg-gray-100',
        )}
      >
        <span className="block truncate font-medium">{conv.title}</span>
        <span className="block text-xs text-gray-400">{formatKst(conv.updatedAt)}</span>
      </Link>
      <IconButton
        label="대화 메뉴"
        className="absolute top-1.5 right-1 size-7 opacity-0 group-hover:opacity-100 focus:opacity-100"
        onClick={() => setMenu((m) => !m)}
      >
        <MoreHorizontal className="size-4" />
      </IconButton>
      {menu && (
        <div
          className="absolute top-9 right-1 z-20 w-36 rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
          onMouseLeave={() => setMenu(false)}
        >
          <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-100" onClick={() => (setMenu(false), setEditing(true))}>
            <Pencil className="size-3.5" /> 이름 바꾸기
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-danger-700 hover:bg-danger-50"
            onClick={() => {
              setMenu(false)
              if (confirm(`"${conv.title}" 대화를 목록에서 지울까요?`)) remove.mutate()
            }}
          >
            <Trash2 className="size-3.5" /> 삭제
          </button>
        </div>
      )}
    </div>
  )
}

export function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const { conversationId } = useParams()
  const conversations = useQuery({ queryKey: qk.conversations, queryFn: api.conversations })
  const settings = useQuery({ queryKey: qk.settings, queryFn: api.settings, staleTime: 5 * 60_000 })
  const vehicles = useQuery({ queryKey: qk.vehicles, queryFn: api.vehicles, staleTime: 60_000 })
  const attention = (vehicles.data ?? []).filter((v) => v.status === '보류' || v.status === '갱신 후보').length
  const nav = ({ isActive }: { isActive: boolean }) =>
    cn('flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm', isActive ? 'bg-primary-50 font-medium text-primary-700' : 'text-gray-700 hover:bg-gray-100')

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <Link to="/" onClick={onNavigate} className="px-1 py-1">
        <Logo />
      </Link>
      <Link to="/" onClick={onNavigate} className={buttonClass('primary', 'md', 'w-full')}>
        <Plus className="size-4" aria-hidden /> 새 작업
      </Link>

      <nav aria-label="대화 목록" className="-mx-1 flex-1 overflow-y-auto px-1">
        <p className="px-2 pb-1 text-xs font-semibold text-gray-400">대화</p>
        {conversations.isLoading && (
          <div className="flex justify-center py-6 text-gray-400">
            <Spinner />
          </div>
        )}
        {conversations.isError && <p className="px-2 text-sm text-danger-700">대화 목록을 불러오지 못했습니다.</p>}
        {conversations.data?.length === 0 && <p className="px-2 py-3 text-sm text-gray-400">아직 대화가 없습니다.</p>}
        <div className="flex flex-col gap-0.5">
          {conversations.data?.map((c) => (
            <ConversationItem key={c.id} conv={c} active={c.id === conversationId} onNavigate={onNavigate} />
          ))}
        </div>
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-gray-200 pt-3">
        <NavLink to="/jobs" className={nav} onClick={onNavigate}>
          <LayoutList className="size-4" aria-hidden /> 작업 결과
        </NavLink>
        <NavLink to="/sources" className={nav} onClick={onNavigate}>
          <Radar className="size-4" aria-hidden /> 수집 현황
          {attention > 0 && (
            <span className="ml-auto rounded-full bg-warning-50 px-1.5 text-xs font-semibold text-warning-700" title="보류·갱신 후보">
              {attention}
            </span>
          )}
        </NavLink>
        {settings.data?.spreadsheetUrl ? (
          <a href={settings.data.spreadsheetUrl} target="_blank" rel="noreferrer" className={nav({ isActive: false })}>
            <FileSpreadsheet className="size-4" aria-hidden /> Google Sheets 열기
            <ExternalLink className="ml-auto size-3.5 text-gray-400" aria-hidden />
          </a>
        ) : (
          <span className="flex items-center gap-2 px-2.5 py-2 text-sm text-gray-400" title="Google Sheets가 아직 연결되지 않았습니다">
            <FileSpreadsheet className="size-4" aria-hidden /> Google Sheets 미연결
          </span>
        )}
      </div>
    </div>
  )
}
