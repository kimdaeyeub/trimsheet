import type { ReviewCode } from '@shared/types';

// Single source of truth for the spreadsheet layout (PLAN.md §4.1).
// Every tab, column order and Korean header lives here; nothing else hardcodes a header.

export interface ColumnSpec {
	key: string;
	header: string;
	/** Dropdown (data validation) values for this column. */
	choices?: readonly string[];
	/** Number column shown as #,##0. */
	number?: boolean;
}

export interface TabSpec {
	key: TabKey;
	title: string;
	hidden?: boolean;
	columns: readonly ColumnSpec[];
}

export const ITEM_STATUS = ['자동 확정', '확인 필요', '승인', '수정됨', '제외'] as const;
export const VEHICLE_STATUS = ['처리 완료', '처리 중', '기준선', '갱신 후보', '보류', '이전 연식'] as const;
export const REVIEW_PROGRESS = ['대기', '완료'] as const;

const c = (key: string, header: string, extra: Omit<ColumnSpec, 'key' | 'header'> = {}): ColumnSpec => ({
	key,
	header,
	...extra,
});

const ITEM_HEAD = [
	c('itemId', '항목ID'),
	c('jobId', '작업ID'),
	c('brand', '브랜드'),
	c('vehicleName', '차종'),
	c('modelYear', '연식'),
];
const ITEM_TAIL = [
	c('status', '상태', { choices: ITEM_STATUS }),
	c('reviewReasons', '확인 사유'),
	c('updatedAt', '갱신일'),
];

export const TABS = {
	trim: {
		key: 'trim',
		title: '트림',
		columns: [
			...ITEM_HEAD,
			c('name', '트림'),
			c('price', '가격(원)', { number: true }),
			c('priceNote', '가격 비고'),
			c('powertrain', '파워트레인'),
			c('evidencePage', '근거 페이지', { number: true }),
			c('evidenceQuote', '근거 원문'),
			...ITEM_TAIL,
		],
	},
	color: {
		key: 'color',
		title: '색상',
		columns: [
			...ITEM_HEAD,
			c('kind', '구분'),
			c('name', '색상명'),
			c('code', '색상 코드'),
			c('hex', '헥사코드(근사값)'),
			c('preview', '미리보기'),
			c('hexSource', '헥사 출처'),
			c('applicableTrims', '적용 트림'),
			c('evidencePage', '근거 페이지', { number: true }),
			c('evidenceQuote', '근거 원문'),
			...ITEM_TAIL,
		],
	},
	option: {
		key: 'option',
		title: '선택품목',
		columns: [
			...ITEM_HEAD,
			c('name', '옵션명'),
			c('price', '가격(원)', { number: true }),
			c('applicableTrims', '적용 트림'),
			c('includes', '포함 사양'),
			c('evidencePage', '근거 페이지', { number: true }),
			c('evidenceQuote', '근거 원문'),
			...ITEM_TAIL,
		],
	},
	rule: {
		key: 'rule',
		title: '옵션규칙',
		columns: [
			...ITEM_HEAD,
			c('type', '유형'),
			c('subject', '대상 옵션'),
			c('targets', '관련 항목'),
			c('condition', '조건'),
			c('result', '결과'),
			c('footnoteText', '원문 각주'),
			c('evidencePage', '근거 페이지', { number: true }),
			...ITEM_TAIL,
		],
	},
	review: {
		key: 'review',
		title: '확인필요',
		columns: [
			c('itemId', '항목ID'),
			c('jobId', '작업ID'),
			c('vehicleName', '차종'),
			c('sheet', '시트'),
			c('label', '항목'),
			c('reasons', '사유'),
			c('passA', '1차 값'),
			c('passB', '2차 값'),
			c('evidencePage', '근거 페이지', { number: true }),
			c('evidenceQuote', '근거 원문'),
			c('progress', '처리', { choices: REVIEW_PROGRESS }),
		],
	},
	vehicle: {
		key: 'vehicle',
		title: '차량',
		columns: [
			c('vehicleKey', '차량키'),
			c('familyKey', '계열키'),
			c('brand', '브랜드'),
			c('vehicleName', '차종'),
			c('modelYear', '연식'),
			c('effectiveDate', '가격표 기준일'),
			c('status', '상태', { choices: VEHICLE_STATUS }),
			c('lastJobId', '최근 작업ID'),
			c('sourceId', '소스ID'),
			c('sha256', 'sha256'),
			c('sourceUrl', '원본 URL'),
			c('reason', '판정 사유'),
			c('firstSeenAt', '최초 확인일'),
			c('updatedAt', '갱신일'),
		],
	},
	job: {
		key: 'job',
		title: '작업',
		columns: [
			c('jobId', '작업ID'),
			c('conversationId', '대화ID'),
			c('brand', '브랜드'),
			c('vehicleName', '차종'),
			c('modelYear', '연식'),
			c('effectiveDate', '가격표 기준일'),
			c('filename', '원본 파일명'),
			c('sourceUrl', '원본 URL'),
			c('pdfKey', 'PDF 키'),
			c('stage', '단계'),
			c('outcome', '결과'),
			c('modelA', '1차 모델'),
			c('modelB', '2차 모델'),
			c('trimCount', '트림 수', { number: true }),
			c('colorCount', '색상 수', { number: true }),
			c('optionCount', '옵션 수', { number: true }),
			c('ruleCount', '규칙 수', { number: true }),
			c('reviewCount', '확인 필요 수', { number: true }),
			c('createdAt', '생성일'),
			c('updatedAt', '갱신일'),
			c('error', '오류'),
		],
	},
	pdf: {
		key: 'pdf',
		title: 'PDF목록',
		columns: [
			c('sourceId', '소스ID'),
			c('brand', '브랜드'),
			c('vehicleName', '차종'),
			c('modelYear', '연식'),
			c('origin', '출처'),
			c('sourceUrl', '원본 URL'),
			c('filename', '파일명'),
			c('pdfKey', 'PDF 키'),
			c('sha256', 'sha256'),
			c('sizeBytes', '크기(바이트)', { number: true }),
			c('pageCount', '페이지 수', { number: true }),
			c('kind', '종류'),
			c('etag', 'ETag'),
			c('lastModified', 'Last-Modified'),
			c('fetchedAt', '수집일'),
			c('verdict', '판정'),
		],
	},
	scan: {
		key: 'scan',
		title: '스캔기록',
		columns: [
			c('scanRunId', '스캔ID'),
			c('trigger', '실행 방식'),
			c('mode', '모드'),
			c('startedAt', '시작'),
			c('finishedAt', '종료'),
			c('candidateCount', '후보 수', { number: true }),
			c('processCount', '처리 수', { number: true }),
			c('skipCount', '건너뜀 수', { number: true }),
			c('holdCount', '보류 수', { number: true }),
			c('failures', '실패 내역'),
		],
	},
	conversation: {
		key: 'conversation',
		title: '_대화',
		hidden: true,
		columns: [c('id', '대화ID'), c('title', '제목'), c('createdAt', '생성일'), c('updatedAt', '갱신일'), c('deleted', '삭제됨')],
	},
	notification: {
		key: 'notification',
		title: '_알림',
		hidden: true,
		columns: [
			c('id', '알림ID'),
			c('kind', '종류'),
			c('title', '제목'),
			c('body', '내용'),
			c('jobId', '작업ID'),
			c('scanRunId', '스캔ID'),
			c('createdAt', '생성일'),
			c('read', '읽음'),
		],
	},
	setting: {
		key: 'setting',
		title: '_설정',
		hidden: true,
		columns: [c('key', '키'), c('value', '값')],
	},
} as const satisfies Record<string, Omit<TabSpec, 'key'> & { key: string }>;

export type TabKey = keyof typeof TABS;
export const TAB_LIST: readonly TabSpec[] = Object.values(TABS) as readonly TabSpec[];

/** Header row (Korean) for a tab. */
export const headersOf = (tab: TabSpec): string[] => tab.columns.map((col) => col.header);

/** Brand label used in sheet cells. */
export const BRAND_LABEL = { hyundai: '현대', kia: '기아', genesis: '제네시스' } as const;

export const HEADER_COLOR = '#3742fa';

export const SHEET_LABEL = { trim: '트림', color: '색상', option: '선택품목', rule: '옵션규칙' } as const;

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
};

export const RULE_TYPE_LABEL = {
	exclusive: '상호배제',
	requires: '의존성',
	includes: '포함',
	trim_only: '트림 한정',
	other: '기타',
} as const;

export const COLOR_KIND_LABEL = { exterior: '외장', interior: '내장' } as const;
