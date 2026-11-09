import type { JobOutcome, JobRow, JobStage, ReviewCode } from '@shared/types'
import type { Tone } from '../components/ui/Badge'

export const STAGE_LABEL: Record<JobStage, string> = {
  created: '생성됨',
  prepared: '분석 완료',
  pass_a_done: '1차 추출 완료',
  pass_b_done: '2차 추출 완료',
  finalized: '완료',
  skipped: '건너뜀',
  failed: '실패',
}

export const OUTCOME_LABEL: Record<JobOutcome, string> = {
  ok: '정리 완료',
  not_pricesheet: '가격표 아님',
  scanned: '스캔본',
  duplicate: '이미 정리됨',
  older_year: '이전 연식',
  held: '보류',
  error: '오류',
}

export const REASON_LABEL: Record<ReviewCode, string> = {
  PASS_MISMATCH: '1·2차 불일치',
  ONLY_IN_A: '1차에만 있음',
  ONLY_IN_B: '2차에만 있음',
  EVIDENCE_NOT_FOUND: '근거 원문 불일치',
  LOW_CONFIDENCE: '모델 확신 낮음',
  INVALID_PRICE: '가격 형식 오류',
  UNKNOWN_REFERENCE: '없는 옵션/트림 참조',
  RULE_CONFLICT: '규칙 모순',
  RULE_OTHER: '해석 불가 규칙',
  DUPLICATE: '중복',
  SCANNED_PDF: '스캔본',
  FALLBACK_MODEL: '폴백 모델 사용',
  HEX_APPROX: '헥사코드 근사값',
}

export const TOOL_LABEL: Record<string, string> = {
  register_pdf_url: 'PDF 내려받기',
  prepare_source: 'PDF 분석',
  extract_pass: '데이터 추출',
  finalize_job: '검증 · 시트 반영',
  get_job: '작업 상태 확인',
  search_vehicles: '차량 검색',
  find_pdfs_on_page: '페이지에서 PDF 찾기',
}

export const modelLabel = (model: string | undefined | null) => {
  if (!model) return ''
  if (model.includes('glm')) return 'GLM-4.7-Flash'
  if (model.startsWith('openai/')) return `OpenAI ${model.slice(7)}`
  return model
}

export function jobStatus(job: Pick<JobRow, 'stage' | 'outcome'>): { label: string; tone: Tone } {
  const outcome = job.outcome as JobOutcome | ''
  if (job.stage === 'failed' || outcome === 'error') return { label: '실패', tone: 'danger' }
  if (job.stage === 'skipped') return { label: outcome ? OUTCOME_LABEL[outcome] : '건너뜀', tone: 'neutral' }
  if (job.stage === 'finalized') return outcome === 'not_pricesheet' ? { label: '가격표 아님', tone: 'neutral' } : { label: '완료', tone: 'success' }
  return { label: STAGE_LABEL[job.stage as keyof typeof STAGE_LABEL] ?? '진행 중', tone: 'primary' }
}
