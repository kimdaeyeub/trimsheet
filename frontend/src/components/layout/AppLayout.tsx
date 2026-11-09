import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { Outlet } from 'react-router'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { qk } from '../../lib/query'
import { IconButton } from '../ui/Button'
import { Logo } from './Logo'
import { NotificationBell } from './NotificationBell'
import { Sidebar } from './Sidebar'

function SheetsBanner() {
  const { data } = useQuery({ queryKey: qk.health, queryFn: api.health, staleTime: 5 * 60_000 })
  if (!data || data.sheets === 'ok') return null
  const text =
    data.sheets === 'error'
      ? 'Google Sheets 연결에 실패했습니다. 서비스 계정 공유와 키 설정을 확인하세요 (docs/google-sheets-setup.md).'
      : 'Google Sheets가 아직 연결되지 않았습니다 — 결과는 임시 저장소에만 저장되고 서버를 다시 시작하면 사라집니다.'
  return (
    <div role="status" className="flex items-center gap-2 border-b border-warning-500/30 bg-warning-50 px-4 py-2 text-sm text-warning-700">
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      {text}
    </div>
  )
}

export function AppLayout() {
  const [drawer, setDrawer] = useState(false)
  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden w-[272px] shrink-0 border-r border-gray-200 bg-white md:block">
        <Sidebar onNavigate={() => {}} />
      </aside>

      {/* Mobile drawer */}
      <div className={cn('fixed inset-0 z-40 md:hidden', drawer ? 'pointer-events-auto' : 'pointer-events-none')}>
        <div className={cn('absolute inset-0 bg-black/30 transition-opacity', drawer ? 'opacity-100' : 'opacity-0')} onClick={() => setDrawer(false)} />
        <aside className={cn('absolute inset-y-0 left-0 w-[272px] bg-white shadow-xl transition-transform', drawer ? 'translate-x-0' : '-translate-x-full')}>
          <IconButton label="메뉴 닫기" className="absolute top-3 right-2" onClick={() => setDrawer(false)}>
            <X className="size-5" />
          </IconButton>
          <Sidebar onNavigate={() => setDrawer(false)} />
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-3 md:justify-end">
          <IconButton label="메뉴 열기" className="md:hidden" onClick={() => setDrawer(true)}>
            <Menu className="size-5" />
          </IconButton>
          <span className="md:hidden">
            <Logo />
          </span>
          <span className="ml-auto md:ml-0">
            <NotificationBell />
          </span>
        </header>
        <SheetsBanner />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
