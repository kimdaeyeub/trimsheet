import type { ApiError, CatalogDetail, CatalogPage, HealthResponse, SettingsResponse } from '@shared/types'

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, init)
  } catch {
    throw new ApiRequestError(0, 'network', '서버에 연결할 수 없습니다. 네트워크를 확인하세요.')
  }
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const err = (body as ApiError | null)?.error
    throw new ApiRequestError(res.status, err?.code ?? 'http_error', err?.message ?? `요청 실패 (HTTP ${res.status})`)
  }
  return body as T
}

export interface CatalogQuery {
  page: number
  pageSize: number
  brand: string
  q: string
  fresh?: boolean
}

const qs = (o: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '' && v !== false) p.set(k, v === true ? '1' : String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const api = {
  health: () => request<HealthResponse>('/health'),
  settings: () => request<SettingsResponse>('/settings'),
  catalog: (q: CatalogQuery) => request<CatalogPage>(`/catalog${qs({ page: q.page, pageSize: q.pageSize, brand: q.brand, q: q.q, fresh: q.fresh })}`),
  vehicle: (id: string) => request<CatalogDetail>(`/catalog/${encodeURIComponent(id)}`),
}
