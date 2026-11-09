import type {
  ApiError,
  Conversation,
  HealthResponse,
  ItemAction,
  ItemActionResponse,
  JobDetailResponse,
  JobRow,
  JobState,
  NotificationsResponse,
  ScanRunsResponse,
  VehicleRow,
  SettingsResponse,
  UploadResponse,
} from '@shared/types'

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
  if (res.status === 204) return undefined as T
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const err = (body as ApiError | null)?.error
    throw new ApiRequestError(res.status, err?.code ?? 'http_error', err?.message ?? `요청 실패 (HTTP ${res.status})`)
  }
  return body as T
}

const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(data),
})

export const api = {
  health: () => request<HealthResponse>('/health'),
  settings: () => request<SettingsResponse>('/settings'),

  conversations: () => request<Conversation[]>('/conversations'),
  createConversation: (title?: string) => request<Conversation>('/conversations', json('POST', title ? { title } : {})),
  renameConversation: (id: string, title: string) => request<Conversation>(`/conversations/${id}`, json('PATCH', { title })),
  deleteConversation: (id: string) => request<void>(`/conversations/${id}`, { method: 'DELETE' }),

  upload: (file: File) => {
    const form = new FormData()
    form.set('file', file)
    return request<UploadResponse>('/uploads', { method: 'POST', body: form })
  },

  jobs: (conversationId?: string) =>
    request<JobRow[]>(`/jobs${conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ''}`),
  job: (id: string) => request<JobDetailResponse>(`/jobs/${id}`),
  jobState: (id: string) => request<JobState>(`/jobs/${id}/state`),
  itemAction: (jobId: string, itemId: string, body: ItemAction) =>
    request<ItemActionResponse>(`/jobs/${jobId}/items/${itemId}`, json('PATCH', body)),
  approveAllAuto: (jobId: string) => request<{ approved: number }>(`/jobs/${jobId}/approve-all-auto`, { method: 'POST' }),

  vehicles: () => request<VehicleRow[]>('/vehicles'),
  processVehicle: (key: string) => request<{ conversationId: string }>(`/vehicles/${encodeURIComponent(key)}/process`, { method: 'POST' }),
  dismissVehicle: (key: string) => request<void>(`/vehicles/${encodeURIComponent(key)}/dismiss`, { method: 'POST' }),
  scanRuns: () => request<ScanRunsResponse>('/scan-runs'),
  startScan: () => request<{ scanRunId: string; mode: 'baseline' | 'normal' }>('/scan-runs', { method: 'POST' }),

  notifications: () => request<NotificationsResponse>('/notifications'),
  readNotification: (id: string) => request<void>(`/notifications/${id}/read`, { method: 'POST' }),
}
