# 제조사 사이트 메모 (PLAN.md Phase 5.7 / 6.2)

2026-11-10에 내장 브라우저로 직접 확인한 내용입니다. 사이트가 바뀌면 이 문서와
`backend/src/crawl/adapters/*`의 상수를 함께 고칩니다. PDF 파일 자체는 이 조사에서 내려받지 않았습니다.

## 현대 (hyundai.com)

| 항목 | 내용 |
| --- | --- |
| 라인업 페이지 | `https://www.hyundai.com/kr/ko/e/all-vehicles` — Vue SPA, HTML에는 목록이 없어 **브라우저 렌더링 필요**. 렌더링 후 승용·SUV·MPV·N·트럭·버스 카드가 탭 전환 없이 모두 DOM에 있음(42개) |
| 차종 카드 | `a[href*="/kr/ko/e/vehicles/"][href$="/intro"]`, 링크 문구 예: `NEW 디 올 뉴 투싼 3,140만원~`, `코나 Electric 4,152만원~ N line포함` |
| 차종 페이지 | `/kr/ko/e/vehicles/<slug>/intro` |
| 가격표 | 차종 페이지의 `a.ico-priceList`("가격표", `javascript:void(0)`) 클릭 시 `<a>`를 만들어 `https://www.hyundai.com/contents/repn-car/catalog/<slug>_price.pdf`를 엶 |
| 연식 표기 | URL·링크 문구에 없음 → PDF 표지에서 판단 |
| 변경 감지 | 같은 URL의 파일이 교체되는 방식 → `ETag`/`Last-Modified` 비교(L1)가 핵심 |
| 상용·특장 | 포터 II, 포터 II 특장차, ST1, 택시(그랜저 택시, 쏘나타 택시) → 제외 |

## 기아 (kia.com)

| 항목 | 내용 |
| --- | --- |
| 목록 페이지 | `https://www.kia.com/kr/vehicles/catalog-price` — Vue 앱, **브라우저 렌더링 필요** |
| 카테고리 탭 | `a.vehicis-cate__link` : EV / PBV / 승용 / RV / 택시 & 상용 — 클릭해야 해당 탭 카드가 로드됨 |
| 카드 | `.vc-card__wrap` — 문구 = 차종명 + "카탈로그 가격표" |
| 가격표 | 카드 안 `a[href*="/pdf/price/"]` → `/content/dam/kwp/kr/ko/vehicles/pdf/price/price_<slug>.pdf` (GET 직링크) |
| 연식 표기 | 없음 → PDF 표지에서 판단 |
| 상용 | "택시 & 상용" 탭 전체, 봉고Ⅲ(EV 탭에도 있음), PV5 카고·오픈베드·WAV, 그랜버드 → 제외. 여러 카드가 같은 PDF를 가리키기도 함(봉고 탑차/덤프/파워게이트) |
| 참고 | 내부 JSON API(`kwpapi.kia.com`)는 쓰지 않음 — 공개 페이지 렌더링만 사용 |

## 제네시스 (genesis.com)

| 항목 | 내용 |
| --- | --- |
| 목록 페이지 | `https://www.genesis.com/kr/ko/support/download-center/genesis-models.html` — **일반 HTTP GET만으로 목록 전체가 HTML에 있음**(브라우저 불필요) |
| 가격표 링크 | `javascript:viewPdf('<file_key>','genesis-<slug>-pricelist-kor-<YYYYMM>.pdf','BROCHURE')`, 링크 문구 예: `PDF G90 Long Wheel Base 가격표` |
| 다운로드 | `viewPdf`는 `POST /wsvc/kr/api/v2/download-center/pdfview` (form `file_key=<file_key>`)를 새 창으로 제출 → 앱에서는 같은 POST로 받음. 원본 URL은 `…/pdfview?file_key=<key>`로 기록 |
| 예전 가격표 | 같은 차종의 이전 파일이 함께 노출됨(예: G90 `…-202506.pdf`와 `…-202611.pdf`) → 파일명 `YYYYMM`으로 **slug별 최신만** 사용 |
| 연식 표기 | 없음(파일명의 YYYYMM은 게시 연월) → PDF 표지에서 판단 |
| 변경 감지 | 새 파일은 `file_key`와 파일명이 바뀜 → 같은 `file_key`면 같은 파일로 보고 다운로드 생략 |
