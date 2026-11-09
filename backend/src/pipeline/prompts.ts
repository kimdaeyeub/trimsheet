// Extraction prompts (PLAN.md §6.5). Pass A reads table-shaped text, Pass B reads raw text
// footnotes-first, so the two passes do not share the same failure modes.

export type Pass = 'A' | 'B';
export type Section = 'trimsColors' | 'options' | 'rules';

export interface PromptInput {
	pass: Pass;
	section: Section;
	/** `=== p.N ===` marked page text (text mode) — omitted in document mode. */
	pagesText?: string;
	/** Document mode: the PDF is attached; optional page-mapping note for subsets. */
	documentNote?: string;
	knownTrims?: string[];
	knownOptions?: string[];
}

const COMMON = `당신은 현대·기아·제네시스 차량 가격표에서 데이터를 뽑는 정확한 추출기입니다.
반드시 지킬 규칙:
- 결과는 finish 도구로만 제출합니다.
- 모든 항목에 evidence.page(문서의 페이지 번호, 1부터)와 evidence.quote(그 값이 적힌 원문을 고치지 말고 그대로, 40자 이내)를 넣습니다.
- 가격은 원 단위 정수로 씁니다. 쉼표와 "원"은 빼고, "만원" 단위 표는 10,000을 곱합니다. 가격이 없으면 null.
- 확신이 없으면 confidence를 "low"로 둡니다. 모르는 값은 지어내지 말고 null 또는 빈 배열로 둡니다.
- 이름은 PDF 표기를 그대로 씁니다(띄어쓰기·괄호 포함).`;

const SECTION_TASK: Record<Section, string> = {
	trimsColors: `할 일: 문서 정보, 트림, 색상을 추출합니다.
- document.isPriceSheet: 트림별 판매가격 표가 있으면 true. 카탈로그·안내문 등 가격표가 아니면 false로 하고 trims/colors는 빈 배열.
- document.brand: hyundai / kia / genesis 중 하나, 모르면 null.
- document.vehicleName: 표지의 차종명(예: "더 뉴 스타리아 Electric").
- document.modelYear: "2027년형", "2027 MY", "The 2027 ..." 같은 표기에서 4자리 연도만. 표기가 없으면 null(날짜의 연도를 연식으로 쓰지 마세요).
- document.effectiveDate: "2026년 11월 1일 기준" 같은 가격표 기준일을 "YYYY-MM-DD"로. 없으면 null.
- trims: 판매가격 표의 각 트림(name, price, priceNote, powertrain).
- colors: 외장(exterior)/내장(interior) 색상. code는 색상 코드(없으면 null), hex는 null, applicableTrims는 적용 트림 이름 목록(전 트림이면 ["*"]).`,
	options: `할 일: 선택 품목(옵션)을 추출합니다.
- name, price, applicableTrims(선택 가능한 트림 이름 목록, 전 트림이면 ["*"]), includes(포함 사양 목록).
- applicableTrims의 트림 이름은 아래 "트림 목록"에 있는 이름과 글자 그대로 같게 씁니다.`,
	rules: `할 일: 옵션 선택 규칙(주로 표 아래 각주 ※, *, 주))을 추출합니다.
- type: exclusive(상호배제: subject 선택 시 targets 선택 불가), requires(의존성: subject는 targets를 선택해야 선택 가능), includes(subject 선택 시 targets 자동 포함), trim_only(subject는 targets 트림에서만 선택 가능), other(위로 표현할 수 없음).
- subject와 targets는 아래 "트림 목록"·"옵션 목록"에 있는 이름과 글자 그대로 같게 씁니다.
- condition/result: 사람이 읽는 짧은 요약(예: "옵션 A 선택" / "옵션 B 선택 불가").
- footnoteText: 각주 원문 전체를 그대로. evidence.footnote에는 각주 기호(예: "※2").`,
};

const PASS_STYLE: Record<Pass, string> = {
	A: `읽는 순서: 표를 위에서 아래로 한 행씩 읽습니다. 텍스트의 " | "는 표의 열 경계입니다.`,
	B: `읽는 순서: 먼저 문서의 모든 각주(※, *, 주))를 페이지별로 찾아 읽은 다음, 각주가 가리키는 표의 값을 확인하며 추출합니다. 표의 줄바꿈이 어긋나 있을 수 있으니 숫자와 이름의 짝을 신중히 맞춥니다.`,
};

export function buildPrompt(input: PromptInput): string {
	const parts = [COMMON, PASS_STYLE[input.pass], SECTION_TASK[input.section]];
	if (input.knownTrims?.length) parts.push(`트림 목록: ${input.knownTrims.map((t) => `"${t}"`).join(', ')}`);
	if (input.knownOptions?.length) parts.push(`옵션 목록: ${input.knownOptions.map((o) => `"${o}"`).join(', ')}`);
	if (input.pagesText !== undefined) {
		parts.push(`아래는 가격표 PDF에서 뽑은 텍스트입니다. "=== p.N ===" 줄이 페이지 번호입니다.\n\n${input.pagesText}`);
	} else {
		parts.push(`가격표 PDF가 첨부되어 있습니다.${input.documentNote ? `\n${input.documentNote}` : ''}`);
	}
	return parts.join('\n\n');
}
