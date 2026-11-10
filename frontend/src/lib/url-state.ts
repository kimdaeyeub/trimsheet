import { useCallback, useSyncExternalStore } from 'react'

// The whole app is one screen, so its state (filter, page, selected vehicle) lives in the query
// string: shareable, survives reloads, and Back/Forward move between selections.

const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  window.addEventListener('popstate', fn)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('popstate', fn)
  }
}
const getSearch = () => window.location.search

export type UrlState = { brand: string; q: string; page: number; v: string }

function parse(search: string): UrlState {
  const p = new URLSearchParams(search)
  const page = Number(p.get('page'))
  return { brand: p.get('brand') ?? '', q: p.get('q') ?? '', page: Number.isInteger(page) && page > 0 ? page : 1, v: p.get('v') ?? '' }
}

export function useUrlState(): [UrlState, (patch: Partial<UrlState>, opts?: { replace?: boolean }) => void] {
  const search = useSyncExternalStore(subscribe, getSearch)
  const state = parse(search)
  const set = useCallback((patch: Partial<UrlState>, opts?: { replace?: boolean }) => {
    const next = { ...parse(window.location.search), ...patch }
    const p = new URLSearchParams()
    if (next.brand) p.set('brand', next.brand)
    if (next.q) p.set('q', next.q)
    if (next.page > 1) p.set('page', String(next.page))
    if (next.v) p.set('v', next.v)
    const url = `${window.location.pathname}${p.toString() ? `?${p}` : ''}`
    if (opts?.replace) window.history.replaceState(null, '', url)
    else window.history.pushState(null, '', url)
    listeners.forEach((fn) => fn())
  }, [])
  return [state, set]
}
