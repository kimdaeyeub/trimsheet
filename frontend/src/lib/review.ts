import type { SheetName } from '@shared/types'

export interface FieldSpec {
  key: string
  label: string
  kind?: 'text' | 'price' | 'textarea' | 'select' | 'color'
  options?: string[]
  hint?: string
}

/** Mirrors backend/src/sheets/review.ts EDITABLE. */
export const EDIT_FIELDS: Record<SheetName, FieldSpec[]> = {
  trim: [
    { key: 'name', label: '트림' },
    { key: 'price', label: '가격(원)', kind: 'price' },
    { key: 'priceNote', label: '가격 비고' },
    { key: 'powertrain', label: '파워트레인' },
  ],
  color: [
    { key: 'kind', label: '구분', kind: 'select', options: ['외장', '내장'] },
    { key: 'name', label: '색상명' },
    { key: 'code', label: '색상 코드' },
    { key: 'hex', label: '헥사코드(근사값)', kind: 'color', hint: '#RRGGBB' },
    { key: 'applicableTrims', label: '적용 트림', hint: '쉼표로 구분, 전 트림이면 "전 트림"' },
  ],
  option: [
    { key: 'name', label: '옵션명' },
    { key: 'price', label: '가격(원)', kind: 'price' },
    { key: 'applicableTrims', label: '적용 트림', hint: '쉼표로 구분, 전 트림이면 "전 트림"' },
    { key: 'includes', label: '포함 사양', kind: 'textarea', hint: '쉼표로 구분' },
  ],
  rule: [
    { key: 'type', label: '유형', kind: 'select', options: ['상호배제', '의존성', '포함', '트림 한정', '기타'] },
    { key: 'subject', label: '대상 옵션' },
    { key: 'targets', label: '관련 항목', hint: '쉼표로 구분' },
    { key: 'condition', label: '조건' },
    { key: 'result', label: '결과' },
    { key: 'footnoteText', label: '원문 각주', kind: 'textarea' },
  ],
}
