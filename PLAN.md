# TrimSheet 구현 계획서

> 이 문서는 코딩 에이전트가 위에서부터 순서대로 실행할 수 있도록 쓴 작업 계획서입니다.
> 기획 원문은 [project-overview.md](project-overview.md)입니다. 이 문서와 기획서가 충돌하면 **이 문서가 우선**합니다(범위를 좁히고 구체화했기 때문입니다).
>
> 작성일: 2026-11-09 · 개정: 2026-11-09 (v2)
> - v2 변경: 결과 저장소를 **Google Sheets**로, DB(D1) 제거, AI 모델을 **GLM-4.7-Flash + OpenAI 폴백**으로, **중복 수집 방지**와 **최신 연식만 수집** 규칙 추가(§7.11)
>
> 대상 경로: `~/Development/ax/trimsheet`

---

## 0. 한눈에 보기

### 0.1 무엇을 만드나

현대·기아·제네시스 가격표 PDF를 받아 **트림 / 색상 / 선택 품목 / 옵션 규칙**을 근거 페이지와 함께 추출하고, 두 번 추출해 교차검증한 뒤 **Google Sheets에 업로드**하는 **개인용 에이전트 웹앱**입니다.

- 인증/회원/권한 없음 (개인용). 화면은 **에이전트 대화 + 작업 결과(검토) + 수집 현황**만 만듭니다.
- 메인 컬러: **`#3742fa`**
- 프론트엔드, 백엔드 모두 **Cloudflare Workers**에 배포합니다.
- AI 에이전트는 **Flue**(`@flue/runtime` 2.x)로 백엔드에 만들고, 프론트엔드는 **`@flue/react`의 `useFlueAgent`**로 대화합니다.
- **AI 모델**: 기본 `cloudflare/@cf/zai-org/glm-4.7-flash`(Workers AI). PDF를 읽지 못하면 **OpenAI API**로 폴백합니다(§6.2).
- **데이터베이스를 쓰지 않습니다.** 가공한 데이터는 Google Sheets, PDF 파일과 작업 진행 상태는 R2에 둡니다(§0.5).
- **이미 가져온 차량은 다시 가져오지 않고, 차종마다 최신 연식만 가져옵니다**(§7.11).

### 0.2 전체 구조

```
┌──────────────────────────── Browser ─────────────────────────────┐
│ React SPA (frontend)                                              │
│  - useFlueAgent({ url: '/api/agents/trimsheet/<conversationId>' })│
│  - fetch('/api/...')  (REST: 업로드, 작업, 검토, 수집 현황)        │
└───────────────┬───────────────────────────────────────────────────┘
                │ same-origin  /api/*
┌───────────────▼──────────────── trimsheet-frontend (Worker) ──────┐
│ Static Assets(SPA) + worker/index.ts                              │
│  /api/*  → env.BACKEND.fetch(request)   (Service Binding, 프록시) │
└───────────────┬───────────────────────────────────────────────────┘
                │ Service Binding
┌───────────────▼──────────────── trimsheet-backend (Worker) ───────┐
│ Hono app (src/app.ts)                                             │
│  /api/agents/trimsheet/*  → createAgentRouter(TrimSheet)  [Flue]  │
│  /api/agents/watcher/*    → createAgentRouter(Watcher)    [Flue]  │
│  /api/conversations, /api/uploads, /api/files, /api/jobs, ...     │
│ scheduled (cron, 매주 월 09:00 KST) → dispatch(Watcher)           │
│                                                                   │
│ Bindings: AI(Workers AI)  FILES(R2)  BROWSER(Browser Run)         │
│ Secrets : OPENAI_API_KEY, GOOGLE_SERVICE_ACCOUNT_EMAIL,           │
│           GOOGLE_PRIVATE_KEY      Vars: GOOGLE_SPREADSHEET_ID     │
│ Flue agent = Durable Object (FlueTrimSheetAgent, FlueWatcherAgent)│
└──────┬──────────────────────┬─────────────────────────┬───────────┘
       │ env.AI.run           │ fetch (폴백 시)          │ fetch (서비스 계정 JWT)
  Workers AI              OpenAI API              Google Sheets API v4
  glm-4.7-flash           (PDF native 입력)        (결과 스프레드시트 1개)
```

### 0.3 제품 선택과 이유

| 필요 | 제품 | 이유 |
| --- | --- | --- |
| SPA 호스팅 + `/api` 프록시 | Workers + Static Assets | 이미 `frontend/`가 이 구조. same-origin이라 CORS 불필요 |
| 프론트 → 백엔드 호출 | Service Binding | 백엔드를 공개 URL 없이 호출, SSE 스트림도 그대로 통과 |
| 에이전트 대화/상태 | Flue (Durable Objects) | Flue cloudflare target이 에이전트마다 DO를 자동 생성. 우리가 관리하지 않음 |
| LLM | Workers AI `@cf/zai-org/glm-4.7-flash` | 사용자 지정. 131,072 토큰 컨텍스트, function calling 지원(Cloudflare 문서 확인). **텍스트 전용** |
| LLM 폴백 | OpenAI API (`openai/<model>`) | GLM이 PDF를 읽지 못하는 경우(스캔본 등) PDF native 입력 지원 |
| **가공 데이터 저장** | **Google Sheets** | 사용자 지정. 사람이 바로 보고 고칠 수 있음 |
| 원본 PDF·중간 결과·작업 상태 | R2 (`FILES`) | 파일 저장소(DB 아님). §0.5 참고 |
| 홈페이지 탐색·PDF 링크 수집 | Browser Run (`BROWSER`, `@cloudflare/playwright`) | 제조사 페이지는 JS로 렌더링됨 |
| 매주 자동 확인 | Cron Triggers | `scheduled` 핸들러에서 `dispatch(Watcher, …)` |
| 알림 | Sheets 숨김 탭 `_알림` + UI 배지 | 개인용이라 앱 내 알림으로 충분 |

### 0.4 기획서 도구 후보 → Workers 환경 대체

| 기획서 후보 | 채택 | 비고 |
| --- | --- | --- |
| Playwright | `@cloudflare/playwright` + Browser Run 바인딩 | Workers용 Playwright 포크 |
| pdfplumber | `unpdf` (pdf.js 서버리스 빌드) | 페이지별 텍스트 + **글자 좌표**로 표 형태 복원(§7.2), 내장 이미지 추출(`extractImages`) |
| (PDF 페이지 분할) | `pdf-lib` | OpenAI 폴백 시 필요한 페이지만 잘라 전송 |
| PDF를 읽는 LLM | GLM-4.7-Flash(텍스트로 변환해 입력) → 실패 시 OpenAI(PDF 직접 입력) | §6.2 |
| openpyxl / Excel | **Google Sheets API** | Excel 파일은 만들지 않음. 필요하면 Sheets에서 `.xlsx`로 내려받기 |
| 이미지 색상 추출 | `unpdf.extractImages` 픽셀 중앙값 | Phase 7 |
| 에이전트 프레임워크 | Flue | 사용자 지정 |

### 0.5 DB 없이 가능한가? → **가능합니다 (D1 등 DB는 쓰지 않음)**

이전 계획에서 D1이 맡던 일을 아래처럼 나눕니다.

| 이전(D1) | 바꾼 곳 | 비고 |
| --- | --- | --- |
| 추출 항목(트림/색상/옵션/규칙), 검토 상태 | **Google Sheets** 데이터 탭 | 시트가 정답(source of truth). 앱의 검토 화면도 시트를 읽고 씀 |
| 차량 등록부(중복·연식 판정용) | Sheets `차량` 탭 | §7.11 |
| 작업 목록·결과 요약 | Sheets `작업` 탭 | |
| PDF 수집 기록 | Sheets `PDF목록` 탭 | |
| 스캔 기록 | Sheets `스캔기록` 탭 | |
| 대화 목록, 알림 | Sheets 숨김 탭 `_대화`, `_알림` | |
| 작업 진행 상태(단계, 진행 문구), 동시 처리 잠금 | R2 `jobs/<id>/state.json`, `locks/…` | 자주 바뀌고 조건부 쓰기가 필요한 값이라 Sheets 대신 R2 |
| 원본 PDF, 중간 추출 결과 | R2 | 파일이라 Sheets에 넣을 수 없음 |

**그래도 남는 저장소 2가지 (DB가 아님)**
1. **R2**: PDF 파일 자체를 둘 곳이 필요합니다(도구 간 전달, 검토 화면의 PDF 뷰어). Google Drive에 올리는 방법은 서비스 계정에 파일 저장 용량이 없어 공유 드라이브 설정이 따로 필요하므로 R2를 씁니다.
2. **Flue 내부 Durable Object 저장소**: 대화 내용을 Flue가 자동으로 저장합니다. 프레임워크 동작이라 끌 수 없고 우리가 관리하지 않습니다.

**DB 없이 감수하는 점 (개인용이라 허용)**
- Sheets API 호출마다 0.3~1초 정도 걸리고 분당 요청 수 한도가 있습니다(🔎 현재 한도 확인). → 작업 하나당 쓰기를 탭별 1회로 묶고, 프론트는 캐시(TanStack Query `staleTime`)를 씁니다.
- 트랜잭션이 없습니다. → 같은 작업이나 같은 차량을 동시에 처리하지 않도록 R2 조건부 쓰기(`state.json`, `locks/vehicle/<key>`)로 막습니다.
- 행을 수정하려면 `항목ID` 열을 읽어 행 번호를 찾아야 합니다. → `src/sheets/rows.ts` 헬퍼로 숨깁니다.
- 데이터가 수만 행이 되면 느려집니다. → 차종마다 최신 연식만 두고(§7.11), 같은 차종을 다시 처리하면 이전 행을 지웁니다(§7.8).

---

## 1. 작업 규칙 (코딩 에이전트 필독)

1. **Phase 순서대로** 진행합니다. 각 Phase 끝의 "완료 조건"을 모두 만족해야 다음 Phase로 넘어갑니다.
2. 체크박스(`- [ ]`)를 완료할 때마다 이 문서에서 `- [x]`로 바꿉니다.
3. **추측하지 말고 확인합니다.** `🔎 검증` 표시 항목은 설치된 패키지 타입, `npx flue docs search <query>` / `npx flue docs read <path>`, Cloudflare·Google·OpenAI 문서로 먼저 확인한 뒤 구현합니다. 결과가 이 문서와 다르면 "결정 기록(§13)"에 한 줄 남기고 실제 동작을 따릅니다.
4. Cloudflare 코드는 `.agents/skills/workers-best-practices/SKILL.md`의 안티패턴 표를 지킵니다. 특히:
   - `Env` 타입은 손으로 쓰지 않고 `wrangler types`로 생성합니다.
   - 비밀값(API 키, 서비스 계정 키)은 코드/설정/문서에 넣지 않습니다. 로컬은 `backend/.env`, 배포는 `wrangler secret put`.
   - 모듈 최상위에 요청별 가변 상태를 두지 않습니다. (예외: Google 액세스 토큰 캐시 — 요청과 무관한 값이고 만료 시각을 함께 저장)
   - 응답을 기다리지 않는 비동기 작업은 `ctx.waitUntil()`에 묶습니다.
   - 큰 파일은 무제한 버퍼링하지 말고 R2 스트림을 그대로 반환합니다(다운로드 라우트).
5. 두 프로젝트 모두 Wrangler 설정 파일이 있으므로 CLI는 **Wrangler**를 씁니다.
6. 각 Phase 끝에서 반드시 실행:
   - `cd backend && npm run check:types && npm test`
   - `cd frontend && npm run build && npm run lint`
7. UI 문구와 시트 헤더는 모두 **한국어**로 씁니다.
8. 상수는 한 곳에 모읍니다: 모델·폴백·수집 정책은 `backend/src/shared/config.ts`, 시트 탭·열 정의는 `backend/src/sheets/layout.ts`.

---

## 2. 현재 상태 (2026-11-09 확인)

| 위치 | 상태 |
| --- | --- |
| `backend/` | Flue 2.2 스캐폴드. `src/agents/hello.ts`(Hello, `anthropic/claude-haiku-4-5`), `src/app.ts`(Hono, `/agents/hello`), `src/cloudflare.ts`(빈 export), `wrangler.jsonc`(name `backend`, compat `2026-06-01`, `nodejs_compat`, traces만 켜짐, `FlueHelloAgent` 마이그레이션), `.env`에 `ANTHROPIC_API_KEY`(더 이상 쓰지 않음). 테스트 없음 |
| `frontend/` | Vite 8 + React 19 + Cloudflare Vite plugin 스캐폴드. `worker/index.ts`가 `/api/*`에 더미 JSON 응답. `wrangler.jsonc`(name `frontend`, SPA not_found_handling, observability enabled, traces 없음). `frontend/.git` 존재 |
| 루트 | git 저장소 아님. `.agents/skills/`(cloudflare, workers-best-practices) |

---

## 3. 최종 디렉터리 구조 (목표)

```
trimsheet/
├── PLAN.md
├── project-overview.md
├── docs/
│   ├── google-sheets-setup.md  ← Phase 1.0에서 작성해 사용자에게 전달
│   └── site-notes.md           ← Phase 5.6
├── shared/
│   └── types.ts                ← 프론트/백 공용 DTO "타입만"
├── backend/
│   ├── wrangler.jsonc
│   ├── flue.config.ts
│   ├── vite.config.ts
│   ├── vitest.config.ts
│   ├── fixtures/               ← 테스트용 PDF, 정답 데이터, 가짜 추출 결과
│   ├── scripts/{smoke.sh, eval.ts, golden-from-sheet.ts}
│   └── src/
│       ├── app.ts
│       ├── cloudflare.ts
│       ├── agents/
│       │   ├── trimsheet.ts
│       │   ├── trimsheet.prompt.ts
│       │   └── watcher.ts
│       ├── tools/
│       │   ├── register-pdf-url.ts
│       │   ├── find-pdfs-on-page.ts
│       │   ├── prepare-source.ts
│       │   ├── extract-pass.ts
│       │   ├── finalize-job.ts
│       │   ├── get-job.ts
│       │   ├── search-vehicles.ts
│       │   └── scan-brand.ts
│       ├── pipeline/            ← 순수 로직 (테스트 대상)
│       │   ├── schema.ts
│       │   ├── normalize.ts
│       │   ├── identity.ts      ← 차량 키·차종 계열 키·연식·기준일 파싱 (§7.11)
│       │   ├── dedup.ts         ← 중복/연식/수집 정책 판정 (§7.11)
│       │   ├── pdf-text.ts      ← unpdf 텍스트 + 좌표
│       │   ├── pdf-layout.ts    ← 좌표로 표 형태 텍스트 복원
│       │   ├── structure.ts
│       │   ├── pdf-subset.ts
│       │   ├── prompts.ts
│       │   ├── extract.ts       ← 모델 선택 + 폴백 판단
│       │   ├── quality.ts       ← 폴백 트리거용 품질 점검
│       │   ├── validate.ts
│       │   ├── evidence.ts
│       │   ├── reconcile.ts
│       │   └── hex.ts
│       ├── sheets/              ← Google Sheets 연동 (DB 대체)
│       │   ├── auth.ts          ← 서비스 계정 JWT → 액세스 토큰
│       │   ├── client.ts        ← Sheets API v4 얇은 래퍼
│       │   ├── layout.ts        ← 탭/열 정의 (단일 기준)
│       │   ├── bootstrap.ts     ← 탭·헤더·드롭다운·숨김 자동 생성
│       │   ├── rows.ts          ← 행 ↔ 객체 변환, ID로 행 찾기
│       │   ├── repo.ts          ← 작업/항목/차량/PDF/대화/알림 읽기·쓰기 함수
│       │   └── memory.ts        ← 테스트용 메모리 구현 (같은 인터페이스)
│       ├── store/
│       │   └── r2.ts            ← PDF, 작업 상태, 잠금, 중간 결과
│       ├── crawl/
│       │   ├── browser.ts
│       │   ├── generic.ts
│       │   └── adapters/{types,hyundai,kia,genesis}.ts
│       ├── routes/
│       │   ├── conversations.ts
│       │   ├── uploads.ts
│       │   ├── files.ts
│       │   ├── jobs.ts
│       │   ├── vehicles.ts
│       │   ├── scans.ts
│       │   └── notifications.ts
│       └── shared/{config,env,ids,errors,log}.ts
└── frontend/
    ├── wrangler.jsonc
    ├── vite.config.ts
    ├── worker/index.ts
    └── src/
        ├── main.tsx
        ├── router.tsx
        ├── styles/index.css
        ├── lib/{api.ts, query.ts, format.ts, file.ts, labels.ts}
        ├── components/
        │   ├── ui/
        │   ├── layout/{AppLayout, Sidebar, NotificationBell}.tsx
        │   ├── chat/{ChatView, MessageList, MessageItem, ToolCallCard, Composer, StatusBar}.tsx
        │   ├── chat/tool-cards/{PrepareSourceCard, ExtractPassCard, FinalizeJobCard, SkippedCard, PdfCandidatesCard, GenericToolCard}.tsx
        │   └── review/{SheetTabs, ItemTable, StatusBadge, EvidenceCell, PdfViewer, EditItemDialog}.tsx
        └── pages/{HomePage, ChatPage, JobsPage, JobDetailPage, SourcesPage}.tsx
```

---

## 4. 데이터 모델

### 4.1 Google Sheets 구조 — `backend/src/sheets/layout.ts`

**스프레드시트 1개**(사용자가 만들고 서비스 계정에 공유, ID는 `GOOGLE_SPREADSHEET_ID`)에 아래 탭을 둡니다. 탭·헤더는 앱이 처음 실행될 때 `bootstrap.ts`가 자동으로 만듭니다(없으면 생성, 있으면 헤더 일치 확인).

데이터는 **"긴 형식"**(탭은 고정, 차종은 열로 구분)으로 쌓습니다. 차종별로 탭을 만들지 않는 이유: 차종이 늘면 탭이 수백 개가 되고 필터·DB 반영이 어려워집니다.

**사람이 보는 탭**

| 탭 | 열 (순서 그대로) |
| --- | --- |
| `트림` | 항목ID · 작업ID · 브랜드 · 차종 · 연식 · 트림 · 가격(원) · 가격 비고 · 파워트레인 · 근거 페이지 · 근거 원문 · 상태 · 확인 사유 · 갱신일 |
| `색상` | 항목ID · 작업ID · 브랜드 · 차종 · 연식 · 구분 · 색상명 · 색상 코드 · 헥사코드(근사값) · 미리보기 · 헥사 출처 · 적용 트림 · 근거 페이지 · 근거 원문 · 상태 · 확인 사유 · 갱신일 |
| `선택품목` | 항목ID · 작업ID · 브랜드 · 차종 · 연식 · 옵션명 · 가격(원) · 적용 트림 · 포함 사양 · 근거 페이지 · 근거 원문 · 상태 · 확인 사유 · 갱신일 |
| `옵션규칙` | 항목ID · 작업ID · 브랜드 · 차종 · 연식 · 유형 · 대상 옵션 · 관련 항목 · 조건 · 결과 · 원문 각주 · 근거 페이지 · 상태 · 확인 사유 · 갱신일 |
| `확인필요` | 항목ID · 작업ID · 차종 · 시트 · 항목 · 사유 · 1차 값 · 2차 값 · 근거 페이지 · 근거 원문 · 처리 |
| `차량` | 차량키 · 계열키 · 브랜드 · 차종 · 연식 · 가격표 기준일 · 상태 · 최근 작업ID · 소스ID · sha256 · 원본 URL · 판정 사유 · 최초 확인일 · 갱신일 |
| `작업` | 작업ID · 대화ID · 브랜드 · 차종 · 연식 · 가격표 기준일 · 원본 파일명 · 원본 URL · PDF 키 · 단계 · 결과 · 1차 모델 · 2차 모델 · 트림 수 · 색상 수 · 옵션 수 · 규칙 수 · 확인 필요 수 · 생성일 · 갱신일 · 오류 |
| `PDF목록` | 소스ID · 브랜드 · 차종 · 연식 · 출처 · 원본 URL · 파일명 · PDF 키 · sha256 · 크기(바이트) · 페이지 수 · 종류 · ETag · Last-Modified · 수집일 · 판정 |
| `스캔기록` | 스캔ID · 실행 방식 · 모드 · 시작 · 종료 · 후보 수 · 처리 수 · 건너뜀 수 · 보류 수 · 실패 내역 |

**시스템 탭 (숨김, 앱 전용)**

| 탭 | 열 |
| --- | --- |
| `_대화` | 대화ID · 제목 · 생성일 · 갱신일 · 삭제됨 |
| `_알림` | 알림ID · 종류 · 제목 · 내용 · 작업ID · 스캔ID · 생성일 · 읽음 |
| `_설정` | 키 · 값 (예: `baseline_done` = `TRUE`/`FALSE` — 최초 기준선 등록 여부, §7.11) |

**값 규칙**
- ID: `job_…`, `itm_…`, `scan_…`, `ntf_…` = 접두사 + `crypto.randomUUID()`. 소스ID는 `src_` + sha256 앞 16자(같은 PDF는 같은 ID).
- 차량키·계열키는 §7.11의 `identity.ts` 규칙으로 만듭니다(예: `genesis|g80|2026`, `genesis|g80`).
- 날짜: `2026-11-09 09:00:00` 형식, **KST** 기준 문자열. 가격표 기준일은 `2026-11-01` 형식.
- 데이터 탭 `상태` 열: `자동 확정` / `확인 필요` / `승인` / `수정됨` / `제외` — 드롭다운(데이터 확인) 규칙을 걸어 시트에서 바로 고를 수 있게 함.
- `차량` 탭 `상태` 열: `처리 완료` / `처리 중` / `기준선` / `갱신 후보` / `보류` / `이전 연식` (의미는 §7.11).
- `확인필요` 탭 `처리` 열: `대기` / `완료`. 데이터 탭 상태가 `확인 필요`에서 바뀌면 앱이 `완료`로 맞춤.
- 가격 셀: 숫자 + `#,##0` 표시 형식. `미리보기` 열: 값은 비우고 셀 배경을 헥사코드로 칠함.
- 헤더 행: 굵게, 배경 `#3742fa`, 흰 글씨, 1행 고정.

**시트가 정답(source of truth)** 입니다. 사용자가 시트에서 상태·값을 직접 고쳐도 앱의 검토 화면은 시트를 다시 읽어 그대로 보여 줍니다.

### 4.2 R2 키 규칙 (`FILES` 버킷)

| 키 | 내용 |
| --- | --- |
| `pdf/<sha256>.pdf` | 원본 PDF. `customMetadata`: `filename`, `sourceUrl`, `origin` |
| `jobs/<jobId>/state.json` | 작업 상태 `JobState` (아래) |
| `jobs/<jobId>/pages.json` | 페이지별 원문 텍스트 `{ page, text }[]` |
| `jobs/<jobId>/layout.json` | 페이지별 표 형태 텍스트 `{ page, text }[]` (§7.2) |
| `jobs/<jobId>/subset.pdf` | OpenAI 폴백용 부분 PDF (필요할 때만) |
| `jobs/<jobId>/pass-a.json`, `pass-b.json` | 1차/2차 추출 원본 결과 |
| `jobs/<jobId>/report.json` | 검증·판정 결과 스냅샷(시트에 쓴 내용과 같음) |
| `locks/vehicle/<차량키>.json` | 같은 차량 동시 처리 방지 잠금 `{ jobId, createdAt }` (작업 끝나면 삭제, 30분 지나면 만료로 간주) |

```ts
// backend/src/store/r2.ts
export interface JobState {
  jobId: string;
  conversationId: string | null;
  sourceId: string;
  stage: 'created' | 'prepared' | 'pass_a_done' | 'pass_b_done' | 'finalized' | 'skipped' | 'failed';
  outcome: 'ok' | 'not_pricesheet' | 'scanned' | 'duplicate' | 'older_year' | 'held' | 'error' | null;
  progressNote: string;               // UI 표시용 한 줄
  pageCount: number | null;
  pageMap: PageMap | null;
  isScanned: boolean | null;
  vehicle: { brand: string | null; name: string | null; modelYear: string | null; effectiveDate: string | null;
             vehicleKey: string | null; familyKey: string | null } | null;
  dedup: { action: DedupAction; reason: string; existingJobId?: string } | null;   // §7.11
  models: { passA?: string; passB?: string };   // 실제로 쓴 모델
  fallbackReasons: string[];
  counts: { trims: number; colors: number; options: number; rules: number; review: number } | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- `state.json`과 `locks/…` 쓰기는 R2 조건부 put(`onlyIf`)으로 충돌을 막습니다(🔎 R2 Workers API에서 "없을 때만 생성"과 "etag 일치 시 덮어쓰기" 조건 지정 방법 확인).
- Flue `step.do` 값은 작아야 하므로, 큰 결과는 항상 R2에 쓰고 **키만** step 결과로 반환합니다.

### 4.3 추출 스키마 — `backend/src/pipeline/schema.ts` (valibot)

```ts
import * as v from 'valibot';

export const Evidence = v.object({
  page: v.pipe(v.number(), v.integer(), v.minValue(1)),   // PDF 1-based 페이지
  quote: v.string(),          // 원문 그대로 짧게 (값이 적힌 표 셀/문장/각주)
  footnote: v.optional(v.string()), // 각주 번호/기호 (예: "※2", "*1")
});

const Confidence = v.picklist(['high', 'medium', 'low']);

export const Trim = v.object({
  name: v.string(),
  price: v.nullable(v.number()),         // 원 단위 정수. 표기 없으면 null
  priceNote: v.optional(v.string()),
  powertrain: v.optional(v.string()),
  evidence: Evidence,
  confidence: Confidence,
});

export const Color = v.object({
  kind: v.picklist(['exterior', 'interior']),
  name: v.string(),
  code: v.nullable(v.string()),
  hex: v.nullable(v.string()),           // 텍스트 모델은 null. Phase 7에서 이미지로 채움
  applicableTrims: v.array(v.string()),  // 전 트림이면 ["*"]
  evidence: Evidence,
  confidence: Confidence,
});

export const Option = v.object({
  name: v.string(),
  price: v.nullable(v.number()),
  applicableTrims: v.array(v.string()),
  includes: v.array(v.string()),
  evidence: Evidence,
  confidence: Confidence,
});

export const Rule = v.object({
  type: v.picklist(['exclusive', 'requires', 'includes', 'trim_only', 'other']),
  subject: v.string(),                   // 옵션 이름 (Option.name 과 같은 표기)
  targets: v.array(v.string()),          // 옵션 이름 또는 트림 이름
  condition: v.string(),
  result: v.string(),
  footnoteText: v.string(),              // 각주 원문 그대로
  evidence: Evidence,
  confidence: Confidence,
});

export const DocumentInfo = v.object({
  isPriceSheet: v.boolean(),
  brand: v.nullable(v.picklist(['hyundai', 'kia', 'genesis'])),
  vehicleName: v.nullable(v.string()),
  modelYear: v.nullable(v.string()),     // "2026" 처럼 4자리
  effectiveDate: v.nullable(v.string()), // 가격표 기준일 "YYYY-MM-DD"
  notes: v.array(v.string()),
});

// 출력 토큰 한도를 넘지 않도록 섹션별로 나눠 요청한다 (§6.5)
export const SectionTrimsColors = v.object({ document: DocumentInfo, trims: v.array(Trim), colors: v.array(Color) });
export const SectionOptions = v.object({ options: v.array(Option) });
export const SectionRules = v.object({ rules: v.array(Rule) });

export type Extraction = {
  document: v.InferOutput<typeof DocumentInfo>;
  trims: v.InferOutput<typeof Trim>[];
  colors: v.InferOutput<typeof Color>[];
  options: v.InferOutput<typeof Option>[];
  rules: v.InferOutput<typeof Rule>[];
};
```

### 4.4 확인 필요 사유 코드 (`ReviewReason`)

| 코드 | 시트 표기 | 의미 |
| --- | --- | --- |
| `PASS_MISMATCH` | 1·2차 불일치 | 1·2차 값이 다름 (`detail`에 다른 필드) |
| `ONLY_IN_A` / `ONLY_IN_B` | 1차에만 있음 / 2차에만 있음 | 한쪽 추출에만 있음 |
| `EVIDENCE_NOT_FOUND` | 근거 원문 불일치 | 근거 인용문이 해당 페이지 텍스트에 없음 |
| `LOW_CONFIDENCE` | 모델 확신 낮음 | 모델이 `low`/`medium` 표시 |
| `INVALID_PRICE` | 가격 형식 오류 | 정수가 아니거나 범위(0 < p < 3억) 밖 |
| `UNKNOWN_REFERENCE` | 없는 옵션/트림 참조 | 규칙·색상이 존재하지 않는 이름을 가리킴 |
| `RULE_CONFLICT` | 규칙 모순 | 같은 쌍에 상호배제와 의존성이 동시에 있음 등 |
| `RULE_OTHER` | 해석 불가 규칙 | `type: 'other'` |
| `DUPLICATE` | 중복 | 같은 시트에 같은 키가 2개 이상 |
| `SCANNED_PDF` | 스캔본 | 텍스트 레이어가 거의 없음 → 전 항목 확인 필요 |
| `FALLBACK_MODEL` | 폴백 모델 사용 | 해당 패스를 OpenAI가 처리함(정보성, 단독으로는 확인 필요로 만들지 않음) |
| `HEX_APPROX` | 헥사코드 근사값 | 색상 행 전체. 확인필요 탭에는 차종당 1줄로 묶음 |

`shared/types.ts`에 코드 유니온 타입, `frontend/src/lib/labels.ts`와 `backend/src/sheets/layout.ts`에 한국어 표기 맵을 둡니다.

---

## 5. 백엔드 API 명세

응답은 JSON, 에러는 `{ error: { code: string, message: string } }`. 시트는 매번 읽고(개인용, 단순성 우선) 캐시는 프론트가 합니다.

| 메서드 | 경로 | 데이터 출처 | 설명 |
| --- | --- | --- | --- |
| GET | `/api/health` | — | `{ ok: true, sheets: 'ok' \| 'not_configured' \| 'error', openai: boolean }` |
| GET | `/api/settings` | Sheets | 스프레드시트 URL, 탭별 gid, 수집 정책 값(읽기 전용 표시용) |
| GET | `/api/conversations` | `_대화` | 대화 목록(삭제됨 제외, 최근순) |
| POST | `/api/conversations` | `_대화` | `{ title? }` → `{ id, title }` |
| PATCH | `/api/conversations/:id` | `_대화` | 제목 변경 |
| DELETE | `/api/conversations/:id` | `_대화` | `삭제됨=TRUE` 표시 |
| POST | `/api/uploads` | R2 + `PDF목록` | multipart `file`(PDF, ≤ 50MB) → R2 + 시트 행 → `{ sourceId, filename, pageCount, alreadyKnown: boolean }`. 같은 sha256이면 기존 반환 |
| GET | `/api/files/pdf/:sha.pdf` | R2 | PDF 스트리밍(`inline`) |
| GET | `/api/jobs?conversationId=` | `작업` | 작업 목록 |
| GET | `/api/jobs/:id` | R2 `state.json` + 데이터 탭 | 작업 상태 + 시트별 항목(작업ID로 필터) + PDF URL + 시트 링크 |
| GET | `/api/jobs/:id/state` | R2 `state.json` | 진행 상황만 (도구 카드 폴링용, 시트 호출 없음) |
| PATCH | `/api/jobs/:id/items/:itemId` | 데이터 탭 | `{ action: 'approve' \| 'reject' }` 또는 `{ action: 'edit', data }` → 행 갱신 + `확인필요` `처리` 갱신 |
| POST | `/api/jobs/:id/approve-all-auto` | 데이터 탭 | `자동 확정` → `승인` 일괄 |
| GET | `/api/vehicles?brand=&status=` | `차량` + `작업` | 차량 등록부(상태·판정 사유 포함) |
| POST | `/api/vehicles/:vehicleKey/process` | `차량` | `기준선`/`갱신 후보`/`보류` 차량을 사용자가 처리하도록 승인 → 새 대화 생성 후 `dispatch(TrimSheet, …force)` (§7.11) |
| POST | `/api/vehicles/:vehicleKey/dismiss` | `차량` | `갱신 후보`/`보류`를 무시(상태 유지, 알림 읽음) |
| GET | `/api/scan-runs` | `스캔기록` | 스캔 기록 |
| POST | `/api/scan-runs` | `스캔기록` | 수동 스캔 시작 → `dispatch(Watcher, …)` |
| GET | `/api/notifications` | `_알림` | 목록 + 안 읽은 수 |
| POST | `/api/notifications/:id/read` | `_알림` | 읽음 처리 |
| * | `/api/agents/trimsheet/*` | Flue | `createAgentRouter(TrimSheet)` |
| * | `/api/agents/watcher/*` | Flue | 관찰/디버깅용 |

---

## 6. 에이전트 설계 (Flue)

### 6.1 Flue 사용 원칙 (context7로 확인한 문서 내용)

- 에이전트 모듈 첫 줄은 `'use agent';`. 내보낸 대문자 함수 = 에이전트, **함수 이름이 영구 식별자**, 반환 문자열이 시스템 프롬프트.
- 에이전트마다 Durable Object 클래스 `Flue<이름>Agent` 생성 → `wrangler.jsonc` `migrations`에 등록.
- 훅: `useModel('provider/model')`, `useTool(def)`, `useSubagent(...)`, `useInitialData()`.
- 도구: `defineTool({ name, description, input(valibot), run })`, `run({ data, signal, log, toolCallId })` → `{ output }`.
  - `harness: true` → `harness.prompt(text, { result, model, documents, images, thinkingLevel, signal })`. `result`(valibot)를 주면 모델이 `finish` 도구로 구조화 결과를 내고, 실패 시 `ResultUnavailableError`. `model`로 호출마다 모델을 바꿀 수 있음(→ 폴백에 사용).
  - 한 harness 안에서 `harness.prompt`를 반복 호출하면 **같은 scratch 대화가 이어짐**. harness는 도구 호출 단위.
  - `durable: true` → `step.do(name, fn)`로 단계 기록, 복구 시 완료 단계는 재실행 안 함. `harness.prompt`도 `step.do`로 감쌈.
  - `timeoutMs` → 초과 시 `ToolTimeoutError`(모델이 보고 대화 계속).
- **Workers AI 모델**: `useModel('cloudflare/@cf/zai-org/glm-4.7-flash')`. `wrangler.jsonc`에 `"ai": { "binding": "AI" }`만 있으면 API 키 불필요. 기본적으로 AI Gateway `default`를 경유함.
- **PDF 문서 입력(`documents`)은 Anthropic / Google / OpenAI Responses 모델에서만** 지원. 그 외 모델(GLM 포함)에는 "문서 생략" 텍스트로 대체됨 → **GLM에는 PDF를 직접 주지 않고 텍스트로 변환해서 줍니다.**
- **OpenAI**: `openai/<model-id>`(Flue 직접 OpenAI 프로바이더, `OPENAI_API_KEY` 사용) — Responses API로 PDF native 입력 지원.
- 라우팅: `app.route('/api/agents/trimsheet', createAgentRouter(TrimSheet))`. 대화 URL = 마운트 경로 + `/<conversationId>`.
- 스케줄: `src/cloudflare.ts` 기본 export의 `scheduled` → `dispatch(Agent, { id, message })`. `fetch` export 금지.
- 바인딩 접근: Hono 라우트는 `c.env`, 도구 안에서는 `import { env } from 'cloudflare:workers'`(🔎 Flue DO 안에서 동작 확인, 안 되면 `getCloudflareContext().env` from `@flue/runtime/cloudflare`) — `src/shared/env.ts`의 `getEnv()` 한 곳에 숨김.
- 프론트: `useFlueAgent({ url })` → `messages`, `status`(`idle|connecting|submitted|streaming|error`), `sendMessage(text, opts)`, `historyReady`, `error`, `refresh()`. 메시지 `parts`: `text`, `reasoning`, `file`, `dynamic-tool`(`input-available | output-available | output-error`), `data-*`. `display !== 'visible'`은 숨김.

### 6.2 모델 설정과 폴백 — `backend/src/shared/config.ts`, `pipeline/extract.ts`

```ts
export const MODELS = {
  chat:     'cloudflare/@cf/zai-org/glm-4.7-flash',  // 대화/도구 호출
  extract:  'cloudflare/@cf/zai-org/glm-4.7-flash',  // 1·2차 추출 기본 (텍스트 입력)
  fallback: 'openai/gpt-5.5',                        // 🔎 사용 가능한 최신 OpenAI 모델 ID로 확정 (PDF 입력 지원 모델)
} as const;

export const FALLBACK = {
  enabled: true,                 // OPENAI_API_KEY 가 없으면 자동 false
  minTextCharsPerPage: 50,       // 이 미만이면 스캔본 → 바로 폴백
  maxEvidenceMissRate: 0.3,      // 근거 원문 불일치 비율이 이보다 크면 해당 패스를 폴백으로 재시도
  maxLayoutChars: 300_000,       // GLM 입력 텍스트 상한. 넘으면 관련 페이지만, 그래도 넘으면 폴백
} as const;
```

**GLM이 PDF를 읽는 방식**: GLM은 텍스트 전용이므로 `prepare_source`가 `unpdf`로 뽑은 **좌표 기반 표 형태 텍스트**(§7.2)를 프롬프트에 넣습니다. 각 페이지 앞에 `=== p.3 ===` 표시를 붙여 근거 페이지를 낼 수 있게 합니다.

**OpenAI 폴백 조건** (`extract.ts`의 `chooseModel()` / `shouldRetryWithFallback()`; 패스 단위로 판단):

| # | 조건 | 판단 시점 |
| --- | --- | --- |
| F1 | 스캔본: 페이지 평균 텍스트 < `minTextCharsPerPage` | `prepare_source` 직후 → 처음부터 OpenAI |
| F2 | 관련 페이지 텍스트만으로도 `maxLayoutChars` 초과 | 추출 시작 전 → OpenAI |
| F3 | GLM 결과가 스키마를 2번 연속 통과 못함(`ResultUnavailableError`) | 추출 중 → 같은 패스를 OpenAI로 재시도 |
| F4 | 품질 점검 실패(`quality.ts`): 가격표로 보이는데 트림 0개, 또는 근거 원문 불일치 비율 > `maxEvidenceMissRate` | 패스 결과 직후 → OpenAI로 재시도 |
| F5 | Workers AI 호출 오류(한도 초과, 5xx)가 재시도 후에도 지속 | 추출 중 → OpenAI |

- 폴백 시 OpenAI에는 **PDF 원본(또는 `subset.pdf`)을 `documents`로** 주고, 같은 섹션 스키마로 요청합니다.
- 폴백이 일어나면 `state.json.models`, `fallbackReasons`, `작업` 탭 `1차 모델`/`2차 모델`에 기록하고, 해당 패스 항목에 `FALLBACK_MODEL`(정보성)을 붙입니다.
- `OPENAI_API_KEY`가 없으면 폴백하지 않고 작업을 `failed`(F1·F2) 또는 전 항목 `확인 필요`(F3~F5)로 마감하며, 채팅으로 "OpenAI 키를 설정하면 처리할 수 있다"고 안내합니다.
- 🔎 **GLM 출력 토큰 한도**: Flue/Pi 카탈로그에 GLM-4.7-Flash가 없으면 `maxTokens: 0`(미지정)으로 해석되고, Workers AI 기본 `max_tokens`가 작게 적용될 수 있습니다. Phase 2.0 스파이크에서 긴 JSON 출력이 잘리는지 확인하고, 잘리면 (a) 섹션을 더 잘게 나누거나 (b) `app.ts`에서 `cloudflareBindingProvider`를 직접 등록해 메타데이터/`max_tokens`를 지정하는 방법을 찾아 결정 기록에 남깁니다.
- 🔎 **GLM 구조화 출력**: Flue의 `result`(finish 도구)가 GLM에서 안정적인지 확인. 불안정하면 `extract.ts`에서 `env.AI.run(model, { messages, response_format: { type: 'json_schema', json_schema } })` 직접 호출 대안을 검토(Workers AI JSON 모드 지원 여부 확인).

### 6.3 `TrimSheet` 에이전트 — `src/agents/trimsheet.ts`

```ts
'use agent';
import { useModel, useTool } from '@flue/runtime';
import { MODELS } from '../shared/config.ts';
import { registerPdfUrl } from '../tools/register-pdf-url.ts';
import { prepareSource } from '../tools/prepare-source.ts';
import { extractPass } from '../tools/extract-pass.ts';
import { finalizeJob } from '../tools/finalize-job.ts';
import { getJob } from '../tools/get-job.ts';
import { searchVehicles } from '../tools/search-vehicles.ts';
import { SYSTEM_PROMPT } from './trimsheet.prompt.ts';
// Phase 5+: findPdfsOnPage

export function TrimSheet() {
  useModel(MODELS.chat);
  useTool(registerPdfUrl);
  useTool(prepareSource);
  useTool(extractPass);
  useTool(finalizeJob);
  useTool(getJob);
  useTool(searchVehicles);
  return SYSTEM_PROMPT;
}
```

시스템 프롬프트(`trimsheet.prompt.ts`, 한국어) 필수 내용:

1. 역할: 현대·기아·제네시스 가격표 PDF를 트림/색상/선택 품목/옵션 규칙으로 정리해 Google Sheets에 올리는 에이전트.
2. 범위: 세 브랜드 외 차종, 상용·특장차, 무관한 요청은 "지원 범위가 아니다"라고 답하고 도구를 호출하지 않는다.
3. **처리 순서**: `prepare_source` → `extract_pass(pass:"A")` → `extract_pass(pass:"B")` → `finalize_job`. **각 도구 출력의 `nextStep` 필드를 그대로 따른다**(모든 단계 도구는 다음에 부를 도구와 인자를 `nextStep: { tool, args } | null`로 돌려준다).
4. **이미 가져온 차량**: 도구가 `skipped: true`를 돌려주면 처리를 멈추고 사유(이미 정리됨/이전 연식/보류)와 기존 결과 링크를 알린다. 사용자가 **명시적으로** "다시 정리해 줘", "그래도 처리해 줘"라고 한 경우에만 `prepare_source`를 `force: true`로 다시 부른다. 차종 이름만 말하면(예: "스타리아 정리해 줘") 먼저 `search_vehicles`로 등록 여부를 확인한다.
5. 메시지에 `[source:<sourceId>]`가 있으면 업로드된 PDF. PDF 직링크면 `register_pdf_url`, 차종 페이지 URL이면 `find_pdfs_on_page`(Phase 5).
6. 가격표 아님/스캔본/폴백 사용 사실은 사용자에게 알린다.
7. 추측 금지: 불명확한 값은 지어내지 않고 확인 필요로 남긴다고 설명한다.
8. 완료 보고: "트림 N · 색상 N · 선택 품목 N · 규칙 N 추출, 확인 필요 K건. Google Sheets에 반영했습니다." + 검토 화면 안내(`/jobs/<jobId>`). 표 전체를 채팅에 다시 쓰지 않는다.
9. 답변은 짧은 한국어.

> GLM-4.7-Flash는 대형 모델보다 도구 순서·지시 준수가 약할 수 있습니다. 그래서 **순서 보장과 중복 차단은 프롬프트가 아니라 코드**(`state.json`의 `stage` 검사, `dedup.ts` 판정, `nextStep`)가 맡습니다. Phase 2.10에서 10회 반복 실행해 순서 이탈률을 측정하고, 이탈이 잦으면 §6.4 끝의 "단일 도구 모드"로 전환합니다.

### 6.4 도구 명세

모든 도구는 `src/tools/*.ts`에 `defineTool`로 정의하고 실제 로직은 `pipeline/*`, `sheets/*`, `store/*`, `crawl/*`을 호출합니다. 출력은 **작은 요약 + `nextStep`**. 실행 중 `state.json.progressNote`를 갱신합니다.

| 도구 | 플래그 | 입력 | 동작 | 출력 |
| --- | --- | --- | --- | --- |
| `register_pdf_url` | `durable`, `timeoutMs: 60_000` | `{ url }` | https만, 호스트 화이트리스트(`hyundai.com`, `kia.com`, `genesis.com` 및 하위 도메인). **중복 검사 L1**(같은 URL + 같은 ETag/Last-Modified면 다운로드 생략) → `fetch` → `%PDF` 확인 → sha256 → **L2**(같은 sha면 기존 소스 반환) → R2 → `PDF목록` 행 | `{ sourceId, filename, sizeBytes, alreadyKnown, nextStep: prepare_source }` |
| `prepare_source` | `durable`, `timeoutMs: 120_000` | `{ sourceId, conversationId?, force?: boolean }` | PDF 로드 → `pdf-text`/`pdf-layout` → `structure` → **텍스트에서 차종·연식·기준일 파싱(`identity.ts`, LLM 호출 전)** → **중복/연식 판정 L3(`dedup.ts`)** → 건너뛸 대상이면 `stage='skipped'`로 끝냄 → 아니면 차량 잠금 획득, 작업 생성(`state.json`, `작업` 탭, `차량` 탭 `처리 중`) → 폴백 사전 판단(F1·F2) → `stage='prepared'` | 처리: `{ jobId, pageCount, pageMap, isScanned, vehicle, plannedModel, nextStep: extract_pass A }` / 건너뜀: `{ skipped: true, reason, existingJobId?, sheetUrl, nextStep: null }` |
| `extract_pass` | `durable`, `harness`, `timeoutMs: 900_000` | `{ jobId, pass: 'A' \| 'B' }` | stage 확인 → 섹션 3개(§6.5)를 순서대로 `harness.prompt(..., { result: Section*, model })` → 품질 점검 → 필요 시 폴백 재시도(F3~F5) → R2 `pass-<p>.json` → stage 갱신. **Pass A 직후 LLM이 읽은 `document`(차종·연식·기준일)로 L3 판정을 한 번 더** 실행(정규식이 놓친 경우 대비) → 건너뛸 대상이면 `stage='skipped'`, 잠금 해제 | `{ jobId, pass, model, fallback, counts, nextStep }` 또는 `{ skipped: true, reason, nextStep: null }` |
| `finalize_job` | `durable`, `timeoutMs: 300_000` | `{ jobId }` | stage 확인 → A/B 로드 → `validate` → `evidence` → `reconcile` → (Phase 7: `hex`) → **Sheets 반영**(§7.8) → `차량` 탭 `처리 완료` 갱신 → `작업` 탭 갱신 → `_알림` → 잠금 해제 → `stage='finalized'` | `{ jobId, counts, reviewCount, sheetUrl, jobUrl, nextStep: null }` |
| `get_job` | — | `{ jobId }` | `state.json` 조회 | `{ stage, outcome, counts, progressNote }` |
| `search_vehicles` | — | `{ query, brand? }` | `차량`·`작업` 탭 검색 | `{ vehicles: [{ vehicleKey, name, modelYear, status, lastJobId, effectiveDate }] }` |
| `find_pdfs_on_page` (Phase 5) | `timeoutMs: 120_000` | `{ url }` | Browser Run으로 렌더 → PDF 후보 → 후보마다 `identity.ts`로 연식 파싱 → **최신 연식 후보만 남김**(§7.11 규칙 R2) | `{ candidates: [{ url, label, guessKind, modelYear }], dropped: [{ url, reason }], failure? }` |
| `scan_brand` (Phase 6, Watcher 전용) | `durable`, `timeoutMs: 900_000` | `{ brand, scanRunId, mode }` | 어댑터로 현재 판매 차종·PDF 수집 → §7.11 정책으로 처리/기준선/건너뜀/보류 분류 → 처리 대상만 등록 + TrimSheet 대화 생성 | `{ toProcess, baseline, skipped, held, failures }` |

> **1·2차 추출을 별도 도구 호출로 나누는 이유**: 한 harness 안의 `harness.prompt` 반복 호출은 같은 대화를 이어 가므로, 한 도구 안에서 A·B를 연달아 하면 B가 A의 결과를 보게 됩니다. 패스 내부의 섹션 3개는 같은 대화를 공유해도 됩니다.
> 🔎 Phase 4.0에서 두 `extract_pass` 호출이 서로의 scratch 대화를 보지 않는지 확인. 공유되면 2차 추출만 `env.AI.run`을 직접 호출하는 `pipeline/extract-direct.ts`로 구현.
>
> **단일 도구 모드(대안)**: GLM의 도구 순서 이탈이 잦으면, 채팅 에이전트에게는 `process_pdf({ sourceId, force? })` 하나만 노출하고 그 안에서 준비 → 중복 판정 → A(harness) → B(`extract-direct.ts`) → 마감을 코드로 실행합니다.

### 6.5 프롬프트 전략 — `src/pipeline/prompts.ts`

**섹션 분할** (출력 토큰 한도 대응): 한 패스는 3번의 `harness.prompt`로 이뤄집니다.
1. `SectionTrimsColors`: 문서 정보(차종·**연식**·**기준일** 포함) + 트림 + 색상 (입력: 표지·가격·색상 페이지 텍스트)
2. `SectionOptions`: 선택 품목 (입력: 옵션 페이지 텍스트 + 1단계 트림 이름 목록)
3. `SectionRules`: 옵션 규칙 (입력: 옵션·각주 페이지 텍스트 + 1·2단계의 트림·옵션 이름 목록)

공통 규칙:
- 출력은 `finish` 도구로만.
- 모든 항목에 `evidence.page`(입력 텍스트의 `=== p.N ===` 번호)와 `evidence.quote`(원문 그대로 40자 이내)를 넣는다. **원문을 고쳐 쓰지 말 것.**
- 가격은 원 단위 정수. "만원" 단위 표는 ×10,000. 없으면 `null`.
- `document.modelYear`는 "2026년형", "2026 MY", "The 2026 …" 같은 표기에서 4자리 연도만. 확실하지 않으면 `null`(추측 금지). `effectiveDate`는 "2026년 11월 1일 기준" 같은 표기에서.
- 규칙의 `subject/targets`는 주어진 이름 목록 중 하나와 **문자 그대로 같게**.
- 확신이 없으면 `confidence: 'low'`, 해석 불가 규칙은 `type: 'other'`.
- 텍스트 모델은 색상 칩을 볼 수 없으므로 `hex`는 항상 `null`(OpenAI 폴백일 때만 추정값 허용).
- 가격표가 아니면 `document.isPriceSheet=false`, 나머지는 빈 배열.

패스별 차이:
- **Pass A (표 우선, 좌표 복원 텍스트 `layout.json`)**: 표 행 단위로 읽음.
- **Pass B (각주 우선, 원문 텍스트 `pages.json`)**: 먼저 각주(※, *, 주) 원문을 페이지별로 나열한 뒤 규칙을 만들고 표를 추출. 입력 표현을 A와 다르게 해 같은 오류가 겹칠 가능성을 줄임.
- 두 패스 모두 기본은 GLM이므로 **같은 모델로 인한 상관 오류**가 남습니다. 근거 원문 대조(§7.6)와 규칙 검사가 이를 보완합니다. 정확도 목표 미달 시(Phase 8) Pass B만 OpenAI로 고정하는 설정 `PASS_B_MODEL`을 검토합니다(사용자 결정 필요 — §13).

### 6.6 `Watcher` 에이전트 — `src/agents/watcher.ts` (Phase 6)

- `useModel(MODELS.chat)`, `useTool(scanBrand)`.
- 시스템 프롬프트: "signal `weekly_scan`을 받으면 attributes의 `mode`를 그대로 넘겨 `scan_brand`를 hyundai → kia → genesis 순으로 호출하고 결과를 요약한다."
- 처리 대상 PDF마다 `_대화` 행을 만들고 `dispatch(TrimSheet, { id: conversationId, message: { kind: 'user', body: '[source:<id>] 신규 가격표입니다. 정리해 주세요.' } })`.
  🔎 도구 `run` 안에서 `dispatch` 가능 여부 확인. 안 되면 Cloudflare Queues(`trimsheet-jobs`) + `cloudflare.ts`의 `queue` 핸들러에서 `dispatch`.
- 스캔 끝에 `스캔기록` 마감 + `_알림`(예: "신차·신규 연식 2건, 가격표 갱신 1건 처리 시작 · 보류 1건"). 작업 완료 알림은 `finalize_job`이 따로 추가.

---

## 7. 파이프라인 상세 (순수 로직)

### 7.1 `pdf-text.ts`
- `unpdf`의 `getDocumentProxy`로 문서를 열고, 페이지마다 `page.getTextContent()`의 `items`(`str`, `transform[4]=x`, `transform[5]=y`, `width`, `height`)를 반환. 원문 텍스트(`pages.json`)는 items를 이어 붙여 만듦.
- 🔎 `unpdf`가 workerd에서 동작하는지, `getTextContent` 접근 방법 확인. CPU 시간 측정 로그.

### 7.2 `pdf-layout.ts` — GLM용 표 형태 복원
- 같은 페이지의 items를 y좌표로 묶어 줄을 만듦(허용 오차 = 글자 높이의 0.5배).
- 줄 안에서 x좌표로 정렬, 앞 글자와의 간격이 평균 글자 폭의 2배를 넘으면 ` | `로 구분 → 표의 셀 경계 근사.
- 출력 예:
  ```
  === p.2 ===
  트림 | 판매가격 | 비고
  카고 3인승 2WD 오토 | 41,250,000 | 개별소비세 3.5%
  ```
- 병합 셀은 완벽히 복원되지 않습니다. 이 한계 때문에 근거 원문 대조와 2차 추출이 필요합니다.
- 테스트: fixture PDF의 가격표 페이지 출력 스냅샷.

### 7.3 `structure.ts`
- 출력: `PageMap = { cover: number[], price: number[], color: number[], option: number[], footnote: number[], other: number[] }`, `isScanned`, `looksLikePriceSheet`.
- 키워드 점수: 가격(`판매가격`, `가격`, `트림`), 색상(`컬러`, `색상`, `외장`, `내장`), 옵션(`선택 품목`, `옵션`, `패키지`), 각주(`※`, `*`, `주)`). 1페이지는 항상 `cover`.
- `isScanned`: 페이지 평균 텍스트 < `FALLBACK.minTextCharsPerPage`.
- `looksLikePriceSheet`: 가격 키워드 페이지 ≥ 1 그리고 금액 패턴(`\d{1,3}(,\d{3})+`) ≥ 5개.
- 최종 "가격표 아님"은 Pass A `document.isPriceSheet`와 함께 판단(둘 다 false일 때만).

### 7.4 `pdf-subset.ts` (OpenAI 폴백 전용)
- PDF base64가 12 MiB를 넘거나 100페이지 초과면 `pdf-lib`으로 `pageMap` 관련 페이지(+앞뒤 1)만 복사. Flue 문서 입력 한도는 base64 14 MiB.
- subset 사용 시 프롬프트에 "n번째 페이지 = 원본 p번째"를 넣고, 결과를 `remapPages()`로 원본 번호로 되돌림.

### 7.5 `normalize.ts`
- `normName(s)`: NFKC → 공백 압축 → trim → 괄호 통일 → 영문 소문자 → `·`/`ㆍ` 통일.
- `parsePrice(s)`: "1,234만원", "12,345,000원" 등 → 정수.
- 매칭 키: trim=`normName(name)`, color=`kind|normName(name)`, option=`normName(name)`, rule=`type|normName(subject)|sorted(normName(targets)).join(',')`.

### 7.6 `validate.ts` / `evidence.ts` / `quality.ts`
- `validate`: `INVALID_PRICE`, `UNKNOWN_REFERENCE`, `RULE_CONFLICT`(같은 쌍에 exclusive와 requires/includes 공존, A requires B이고 B exclusive A), `DUPLICATE`, `RULE_OTHER`, `LOW_CONFIDENCE`, 페이지 범위 밖 → `EVIDENCE_NOT_FOUND`.
- `evidence.verifyQuote(pages, page, quote)`: 해당 페이지(±1)의 원문과 인용문을 `normName`+공백 제거 후 부분 문자열 검사, 실패 시 문자 3-gram 자카드 ≥ 0.8이면 통과. 스캔본은 검사 생략 + `SCANNED_PDF`.
- `quality.check(extraction, ctx)`: 폴백 F4 판단 — `looksLikePriceSheet && trims.length === 0` 또는 근거 불일치 비율 > `maxEvidenceMissRate`면 `{ ok: false, reason }`.

### 7.7 `reconcile.ts`
```
for each sheet:
  A = map by key, B = map by key
  for key in union(A, B):
    a, b = A[key], B[key]
    reasons = []
    if !a: reasons += ONLY_IN_B ; final = b
    elif !b: reasons += ONLY_IN_A ; final = a
    else:
      diffs = compareFields(sheet, a, b)   // 가격, 코드, applicableTrims(집합), includes(집합), type, targets(집합)
      if diffs: reasons += PASS_MISMATCH(diffs) ; final = a (둘 다 보존)
      else final = a
    reasons += validate(final) + evidence(final)
    status = reasons(정보성 FALLBACK_MODEL·HEX_APPROX 제외).length == 0 ? '자동 확정' : '확인 필요'
```
- Phase 2(1차만)는 `ONLY_IN_A`를 넣지 않고 validate+evidence만으로 판정(UI에 "검증 통과(단일 추출)" 표시).
- 결과를 R2 `report.json`에 저장하고 §7.8로 시트에 반영.

### 7.8 Sheets 반영 — `sheets/repo.ts` `writeJobResult(jobId, report)`
1. `bootstrap.ensureLayout()` (첫 실행 시 탭/헤더/서식/드롭다운/숨김 탭 생성, 이후엔 메타데이터만 확인).
2. **이전 결과 정리**: 데이터 탭 4개와 `확인필요` 탭에서 **같은 차량키**(브랜드+차종+연식)이면서 작업ID가 다른 행을 삭제(`deleteDimension`, 아래 행부터). 이는 사용자가 `force`로 다시 정리했거나 같은 연식의 새 가격표를 자동 갱신(R4)한 경우에만 일어납니다(§7.11). `작업` 탭은 이력이므로 남김.
3. **추가**: 탭별로 `values.append`(`valueInputOption=RAW`, `insertDataOption=INSERT_ROWS`) **1회씩**.
4. **서식**: 색상 탭 `미리보기` 셀 배경을 hex로 칠하는 `repeatCell` 요청들을 `batchUpdate` 1회로.
5. `차량` 탭(upsert)·`작업` 탭 해당 행 갱신(`values.batchUpdate`).
6. 실패 시 3회 지수 백오프 재시도(429/5xx). 그래도 실패하면 `stage='failed'`, `error='시트 반영 실패'`(R2 `report.json`이 남아 있으므로 `finalize_job`을 다시 부르면 재반영 가능).

### 7.9 Sheets 클라이언트 — `sheets/auth.ts`, `sheets/client.ts`
- `googleapis` 패키지는 Node 전용 의존성이 많아 쓰지 않고 `fetch`로 직접 호출합니다.
- **인증(서비스 계정)**:
  1. JWT 헤더 `{ alg: 'RS256', typ: 'JWT' }`, 클레임 `{ iss: GOOGLE_SERVICE_ACCOUNT_EMAIL, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }`.
  2. `GOOGLE_PRIVATE_KEY`(PEM, `\n` 이스케이프 복원) → `crypto.subtle.importKey('pkcs8', …, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' })` → 서명.
  3. `POST https://oauth2.googleapis.com/token` (`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`, `assertion=<jwt>`) → `access_token`.
  4. 토큰은 만료 60초 전까지 모듈 메모리에 캐시(요청과 무관한 값, 만료 시각과 함께 저장).
- **사용 엔드포인트** (base `https://sheets.googleapis.com/v4/spreadsheets/{id}`):
  - `GET ?fields=sheets.properties` (탭 목록·gid)
  - `GET /values:batchGet?ranges=...`
  - `POST /values/{range}:append`
  - `POST /values:batchUpdate`
  - `POST :batchUpdate` (`addSheet`, `updateSheetProperties`(고정 행·숨김), `deleteDimension`, `repeatCell`, `setDataValidation`)
- 🔎 Sheets API 현재 요청 한도(분당, 사용자/프로젝트별)를 확인해 결정 기록에 남깁니다.
- `sheets/memory.ts`: 같은 인터페이스(`SheetsPort`)의 메모리 구현. 단위 테스트와 Sheets 설정 전 로컬 개발에 사용(`GOOGLE_SPREADSHEET_ID`가 비어 있으면 자동 사용하고 `/api/health`에 `not_configured`).

### 7.10 `hex.ts` (Phase 7)
- `unpdf`의 `extractImages(pdf, pageNumber)`로 색상 페이지 내장 이미지(raw 픽셀).
- 칩 후보: 20~400px, 종횡비 0.5~2, 픽셀 분산이 낮은 이미지. 대표색 = 가장자리 10% 제외 후 RGB 중앙값 → `#RRGGBB`.
- 칩 ↔ 색상명 매칭: 페이지 내 칩 순서와 추출된 색상 순서를 1:1. 개수가 다르면 매칭하지 않음.
- 출처: `이미지` / `OpenAI 추정`(폴백 때만) / 비어 있음. 모든 hex에 `HEX_APPROX`.
- 🔎 실제 PDF의 칩이 래스터 이미지인지 확인. 벡터면 이 방법은 못 쓰므로, 사용자 동의 하에 색상 페이지만 OpenAI 비전으로 추정하는 옵션을 결정 기록에 남깁니다.

### 7.11 중복 방지와 수집 범위 제한 — `pipeline/identity.ts`, `pipeline/dedup.ts`

**목표**
1. 이미 가져온 차량(같은 차종·같은 연식)은 다시 가져오지 않는다.
2. 차종마다 **최신 연식만** 가져온다. 예: 제네시스 G80 2026년형이 있으면 2025년형은 가져오지 않는다.
3. 에이전트가 처음 작동할 때 단종·과거 모델을 포함한 전체 차량을 한꺼번에 가져오지 않는다.

**(1) 차량 식별 — `identity.ts`**

| 개념 | 만드는 법 | 예 |
| --- | --- | --- |
| 연식 `modelYear` | 파일명·링크 문구·표지 텍스트에서 `/(20\d{2})\s*(년형\|MY\|Model Year)/`, `/The\s+(20\d{2})/`, `/(20\d{2})\s*[^\d]*(가격표\|price)/i` 순서로 찾음. 여러 개면 가장 큰 값. 없으면 `null` | `2026 G80 가격표.pdf` → `2026` |
| 차종 계열 키 `familyKey` | `brand` + `normName(차종명)`에서 연식·`더 뉴`·`디 올 뉴`·`New`·`페이스리프트`·`년형` 같은 토큰을 제거. 파워트레인(`Electric`, `하이브리드`, `LPG`)과 바디(`쿠페`, `슈팅브레이크`)는 **남김**(가격표가 따로 나오는 별도 차종이므로) | `genesis` + `더 뉴 G80` → `genesis\|g80` / `G80 전동화` → `genesis\|g80 전동화` |
| 차량 키 `vehicleKey` | `familyKey` + `\|` + `modelYear` | `genesis\|g80\|2026` |
| 기준일 `effectiveDate` | 표지·가격 페이지의 `YYYY년 M월 D일 기준`, `YYYY.MM.DD` | `2026-11-01` |
| 문서 지문 | PDF sha256 | — |

- 계열 키 정규화 규칙은 표로 관리(`FAMILY_STOP_WORDS`, `FAMILY_ALIASES` — 예: `"더 뉴 스타리아"`와 `"스타리아"`를 같은 계열로). 새 별칭은 `docs/site-notes.md`에 근거를 남기고 추가.
- 테스트: 실제 PDF 파일명·표지 문구 20개 이상을 표 기반 테스트로.

**(2) 중복 판정 단계 (싼 것부터)**

| 단계 | 시점 | 비교 대상 | 같으면 |
| --- | --- | --- | --- |
| **L1** URL 지문 | 다운로드 **전** (`register_pdf_url`, `scan_brand`) | `PDF목록`의 `원본 URL` + `ETag`/`Last-Modified`/`Content-Length` (`HEAD` 요청) | 다운로드하지 않고 건너뜀 |
| **L2** 파일 지문 | 다운로드 **후**, LLM **전** | `PDF목록`의 `sha256` | 기존 소스로 연결, 이미 처리된 소스면 건너뜀 |
| **L3** 차량 판정 | `prepare_source`(텍스트 정규식, LLM 전) + Pass A 직후(LLM이 읽은 `document`로 재확인) | `차량` 탭의 같은 `familyKey` 행들 | 아래 규칙표로 결정 |

**(3) 판정 규칙 — `dedup.decide(candidate, registry, policy) → { action, reason, existingJobId? }`**

`action`은 `process`(처리) / `skip`(건너뜀) / `hold`(보류: 사용자 확인 필요) / `update_candidate`(갱신 후보: 알림만 — 현재 정책에서는 쓰지 않고 `sameYearNewerPriceSheet`를 바꿨을 때만 나옴) / `baseline`(기준선 등록만) 중 하나입니다.

| # | 상황 | 결과 | 사유 문구 |
| --- | --- | --- | --- |
| R1 | 같은 `vehicleKey`가 `처리 완료`이고 sha도 같음 | `skip` | 이미 정리된 가격표 |
| R2 | 같은 계열에 **더 최신 연식**이 이미 등록됨 (예: 2026 등록, 후보 2025) | `skip` | 이전 연식 (최신: 2026) |
| R3 | 같은 `vehicleKey`가 `처리 완료`, 파일은 다르고 기준일이 **같거나 더 오래됨** | `skip` | 이미 정리된 차량(같은 연식) |
| R4 | 같은 `vehicleKey`가 `처리 완료`, 파일이 다르고 기준일이 **더 새로움** (가격 인상 등) | `process` | 같은 연식의 새 가격표 — 자동 갱신. 처리 후 그 차량의 이전 결과 행을 새 결과로 교체(§7.8) |
| R4b | 같은 `vehicleKey`가 `처리 완료`, 파일은 다른데 기준일을 **알 수 없음**(둘 중 하나라도) | `hold` | 새 가격표인지 판단 불가 — 사용자 확인 필요 |
| R5 | 같은 `vehicleKey`가 `처리 중`(잠금 있음) | `skip` | 이미 처리 중 |
| R6 | 같은 계열에 등록된 것보다 **새 연식** (예: 2025 등록, 후보 2026) | `process` | 신규 연식 (처리 후 이전 연식 행은 `이전 연식`으로 표시, 데이터 행은 그대로 둠) |
| R7 | 처음 보는 계열 + 최초 스캔(`baseline_done = FALSE`) | `baseline` | 최초 기준선 — 처리하지 않음 (아래 (4)) |
| R8 | 처음 보는 계열 + 기준선 이후 | `process` | 신차 |
| R9 | 연식을 알 수 없음(정규식·LLM 모두 `null`) | `hold` | 연식 불명 — 사용자 확인 필요 |
| R10 | 기준일이 오늘보다 `maxPriceSheetAgeDays` 이상 지남 | `hold` | 오래된 가격표 |
| R11 | 사용자가 채팅에서 명시적으로 요청(`force: true`) | R1·R5를 제외하고 `process` | 사용자 요청으로 다시 정리 (R1은 "같은 파일이라 결과가 같다"고 안내, R5는 "처리 중"이라고 안내) |

- 수동 업로드·URL 입력도 같은 규칙을 거칩니다. 예: 사용자가 G80 2025년형 PDF를 올렸는데 2026년형이 이미 등록돼 있으면 R2로 건너뛰고 "2026년형이 최신입니다. 그래도 정리할까요?"라고 묻습니다(사용자가 "응"이라고 하면 `force`).
- 판정 결과는 항상 `PDF목록` 탭 `판정` 열과 `차량` 탭 `판정 사유` 열에 남겨, 왜 가져오지 않았는지 시트에서 볼 수 있게 합니다.
- **동시 처리 방지**: `process`로 판정되면 R2 `locks/vehicle/<vehicleKey>.json`을 "없을 때만 생성" 조건으로 만들어 잠금. 이미 있으면(30분 이내) R5. 작업이 끝나거나 실패하면 해제.

**(4) 첫 실행 폭주 방지**

| 장치 | 동작 | 설정(`config.ts` `SCAN_POLICY`) |
| --- | --- | --- |
| **현재 판매 차종만 탐색** | 어댑터는 각 브랜드의 **현재 라인업 페이지**에 있는 차종만 방문. 단종·아카이브·과거 모델 페이지와 "지난 가격표" 목록은 탐색하지 않음 | 어댑터 구현 규칙 |
| **차종별 최신 연식 1개만** | 한 차종 페이지에서 여러 연식 PDF가 나오면 계열별로 가장 큰 연식만 남기고 나머지는 `이전 연식`으로 버림(다운로드도 안 함) | `latestModelYearOnly: true` |
| **최초 실행은 기준선만** | `_설정`의 `baseline_done`이 `FALSE`인 첫 스캔은 찾은 최신 가격표를 `차량` 탭에 `기준선`으로 **등록만** 하고 처리(LLM 호출)는 하지 않음. 스캔이 끝나면 `baseline_done=TRUE`. 이후 스캔부터 신차·신규 연식만 처리 | `initialScanMode: 'baseline_only'` (`'process_latest'`로 바꾸면 첫 실행에 최신 연식 전부 처리) |
| **기준선 차량은 원할 때 처리** | 수집 현황 화면에서 `기준선` 차량을 골라 `처리`(→ `POST /api/vehicles/:key/process`). 여러 개 선택 가능하되 한 번에 `maxAutoProcessPerScan`개까지 | — |
| **스캔당 자동 처리 상한** | 한 스캔에서 `process` 판정이 상한을 넘으면 **하나도 자동 처리하지 않고** 전부 `hold`로 돌린 뒤 알림("새 가격표 23건 — 한 번에 너무 많아 자동 처리하지 않았습니다. 수집 현황에서 골라 주세요"). 사이트 구조 변경으로 모든 차가 신차로 보이는 사고도 막음 | `maxAutoProcessPerScan: 10` |
| **오래된 가격표 차단** | 기준일이 너무 오래된 가격표는 `hold` (R10) | `maxPriceSheetAgeDays: 400` |
| **연식 불명 보류** | 연식을 확정하지 못하면 자동 처리하지 않음 (R9) | `unknownYear: 'hold'` |

```ts
// backend/src/shared/config.ts
export const SCAN_POLICY = {
  latestModelYearOnly: true,
  initialScanMode: 'baseline_only' as 'baseline_only' | 'process_latest',
  maxAutoProcessPerScan: 10,
  maxPriceSheetAgeDays: 400,
  unknownYear: 'hold' as const,
  sameYearNewerPriceSheet: 'process' as 'update_candidate' | 'process' | 'skip',  // R4 동작 (사용자 결정: 자동 갱신)
  lockTtlMinutes: 30,
} as const;
```

- **R4(같은 연식의 새 가격표)는 자동으로 다시 정리합니다**(사용자 결정, §13). 조건과 안전장치:
  - "새 가격표"는 **파일(sha)이 다르고 기준일이 더 새로운 경우**만입니다. 파일만 다르고 기준일이 같거나 오래되면 R3로 건너뛰고, 기준일을 알 수 없으면 R4b로 보류합니다(같은 PDF의 재업로드·재압축본 때문에 매주 다시 처리되는 것을 막음).
  - 기준일 비교는 텍스트 정규식으로 먼저 하고(LLM 전), Pass A 직후 LLM이 읽은 `effectiveDate`로 다시 확인합니다. 다시 확인했을 때 새롭지 않으면 그 자리에서 `skipped`로 멈춥니다.
  - 자동 갱신도 **스캔당 자동 처리 상한**(`maxAutoProcessPerScan`)에 포함됩니다.
  - 처리가 끝나면 §7.8 2단계에서 같은 차량키의 이전 결과 행(데이터 탭·`확인필요` 탭)을 지우고 새 결과로 교체합니다. 이전 작업은 `작업` 탭에 이력으로 남고, 이전 PDF는 R2에 남습니다. 사용자가 시트에서 승인·수정했던 내용도 새 결과로 바뀌므로, 알림 문구에 "기존 검토 내용이 새 가격표 결과로 교체되었습니다"를 넣습니다.
  - 정책값을 `'update_candidate'`(알림만) 또는 `'skip'`(무시)으로 바꾸면 이전 동작으로 돌아갑니다.
- **테스트(`dedup.test.ts`, 표 기반)**: R1~R11 각각 + 예시 시나리오
  - G80 2026 `처리 완료` 상태에서 G80 2025 후보 → `skip`(R2)
  - G80 2025 `처리 완료` 상태에서 G80 2026 후보 → `process`(R6)
  - 첫 스캔에서 GV70 2026 → `baseline`(R7)
  - 기준선 이후 신차 GV90 2027 → `process`(R8)
  - 한 스캔에서 `process` 12건 → 전부 `hold`(상한)
  - 같은 차종 페이지에 2025·2026 PDF가 함께 있음 → 2026만 남음

---

## 8. 프론트엔드 설계

### 8.1 패키지
- 런타임: `@flue/react`, `@flue/sdk`(타입), `react-router`(v7, 라이브러리 모드), `@tanstack/react-query`, `lucide-react`, `clsx`
- 스타일: `tailwindcss` v4 + `@tailwindcss/vite`
- 폰트: Pretendard(CDN)
- 🔎 `@flue/react` 버전을 백엔드 `@flue/runtime`(2.2.x)과 맞춤.

### 8.2 디자인 토큰 — `src/styles/index.css`

```css
@import "tailwindcss";

@theme {
  --color-primary-50:  #eef0ff;
  --color-primary-100: #dfe2ff;
  --color-primary-200: #c2c7ff;
  --color-primary-300: #9aa1fd;
  --color-primary-400: #6b74fb;
  --color-primary-500: #3742fa;   /* 메인 컬러 */
  --color-primary-600: #2a33e0;
  --color-primary-700: #2128b5;
  --color-primary-800: #1d238f;
  --color-primary-900: #1c2171;

  --color-success-500: #16a34a;   /* 자동 확정 */
  --color-warning-500: #f59e0b;   /* 확인 필요 / 갱신 후보 / 보류 */
  --color-danger-500:  #dc2626;   /* 실패/제외 */

  --font-sans: "Pretendard Variable", Pretendard, system-ui, sans-serif;
  --radius-card: 12px;
}
```
- 배경 `#f7f8fc`, 카드 흰색 + `border-gray-200`. 주요 버튼 `bg-primary-500 hover:bg-primary-600 text-white`, 포커스 링 `ring-primary-300`. 사용자 말풍선 `bg-primary-500 text-white`.
- 상태 배지: 자동 확정(초록), 확인 필요(주황), 승인(primary), 수정됨(primary-700), 제외(회색 취소선). 차량 상태: 처리 완료(초록), 기준선(회색), 갱신 후보(주황), 보류(주황 테두리), 이전 연식(회색 취소선).
- 접근성: 대비 4.5:1 이상, 아이콘 버튼 `aria-label`, 채팅 목록 `aria-live="polite"`.

### 8.3 화면

**공통 레이아웃 (`AppLayout`)**
- 왼쪽 사이드바(272px): 로고 "TrimSheet", `+ 새 작업`, 대화 목록(이름 변경·삭제), 하단: `작업 결과`(/jobs), `수집 현황`(/sources, 갱신 후보·보류 수 배지), `Google Sheets 열기`(외부 링크).
- 상단 바: 알림 종(안 읽은 수, 드롭다운, 60초 폴링). `/api/health`가 `sheets: 'not_configured'`면 노란 배너 "Google Sheets가 아직 연결되지 않았습니다 — 결과는 임시 저장소에만 저장됩니다."
- 모바일(<768px): 사이드바 드로어.

**① 홈 (`/`)**: 큰 입력창 + 예시 칩("현대 더 뉴 스타리아 Electric 가격표 정리해 줘", "차종 페이지 URL 붙여넣기", "PDF 올리기"). 입력 시 `POST /api/conversations` → `/c/:id`.

**② 대화 (`/c/:conversationId`)**
- `useFlueAgent({ url: `/api/agents/trimsheet/${conversationId}` })`.
- `MessageList`: `display === 'visible'`만. `text`(가벼운 마크다운, `/jobs/...`는 라우터 링크), `reasoning`(접힘), `file`(PDF 카드), `dynamic-tool` → `ToolCallCard`.
- `ToolCallCard`:
  - `prepare_source`: 페이지 수, 인식한 차종·연식·기준일, 스캔본·가격표 아님 경고, 예정 모델(GLM/OpenAI). `skipped: true`면 `SkippedCard`.
  - **`SkippedCard`**: "이미 정리된 차량입니다" / "이전 연식입니다 (최신 2026년형)" / "연식을 확인할 수 없어 보류했습니다" + `기존 결과 보기`(→ `/jobs/:existingJobId`) + `그래도 정리하기` 버튼(클릭 시 "그래도 정리해 줘" 메시지 전송 → 에이전트가 `force: true`로 재호출).
  - `extract_pass`: "1차 추출 중…"/"2차 추출 중…" → 완료 시 개수 + 사용 모델 배지(폴백이면 주황 "OpenAI 사용" 배지와 사유 툴팁).
  - `finalize_job`: **결과 카드** — 개수, 확인 필요 K건, `검토하기`(→ `/jobs/:id`), `Google Sheets에서 보기`(→ `sheetUrl`).
  - `find_pdfs_on_page`: 후보 목록(연식 표시) + 버려진 이전 연식 후보 접힘 목록 + `이 PDF 정리하기` 버튼.
  - 실행 중(`input-available`)이고 `jobId`가 있으면 `GET /api/jobs/:id/state` 2초 폴링으로 `progressNote` 표시. `output-error`는 빨간 카드.
- `Composer`: Enter 전송 / Shift+Enter 줄바꿈 / IME 조합 중 Enter 무시. 📎 PDF 첨부(드래그앤드롭, 50MB) → `POST /api/uploads` → 본문에 `[source:<id>]` 붙여 전송(화면엔 파일 칩, `alreadyKnown`이면 "이전에 올린 파일" 표시). 작업 중엔 전송 비활성(🔎 abort 지원 시 `중단` 버튼).
- `StatusBar`: `connecting`/`error` + `다시 시도`(`refresh()`).
- 첫 메시지 후 대화 제목을 앞 30자로 `PATCH`.

**③ 작업 결과 목록 (`/jobs`)**: 차종 · 연식 · 브랜드 · 결과(완료/건너뜀/실패/가격표 아님) · 확인 필요 수 · 사용 모델 · 생성일 · `시트에서 보기`.

**④ 검토 화면 (`/jobs/:jobId`)**
- 상단: 차종명·연식, 기준일, 원본 PDF 열기, `Google Sheets에서 보기`, 안내 문구 "시트에서 직접 고친 내용도 이 화면에 반영됩니다".
- 좌측(60%): 탭 `확인 필요(K)` · `트림` · `색상` · `선택 품목` · `옵션 규칙`.
  - 행: 값 + 상태 배지 + 근거(`p.3`, 클릭 시 PDF 이동) + 사유 배지.
  - 확인 필요 행: `승인` / `수정` / `제외` → `PATCH` → 시트 갱신 후 재조회. `수정`은 `EditItemDialog`(1차/2차 값 나란히, 선택 또는 직접 입력).
  - 색상 행: hex 칩 + "근사값"/출처. 규칙 행: 원문 각주 인용 블록.
- 우측(40%): `PdfViewer` — `<iframe src={`${pdfUrl}#page=${page}`}>`, 근거 클릭 시 `key` 변경으로 다시 로드.
- 모든 확인 필요 처리 시 "검토 완료" 배너.

**⑤ 수집 현황 (`/sources`)** (Phase 6)
- 상단 요약: 마지막 스캔(모드: 기준선/일반), 다음 예정(매주 월 09:00), `지금 확인`, 최근 실패 사유. 최초 기준선 전이면 "첫 확인에서는 현재 판매 중인 차량을 **기준선으로 등록만** 하고 처리하지 않습니다" 안내.
- 필터 탭: `전체` · `갱신 후보` · `보류` · `기준선` · `처리 완료` · `이전 연식`, 브랜드 선택.
- 차량 표: 차종 · 연식 · 기준일 · 상태 배지 · 판정 사유 · 최근 작업 · 동작(`처리`/`무시`/`결과 보기`). 체크박스로 여러 개 선택 후 `선택 처리`(최대 `maxAutoProcessPerScan`개).

### 8.4 상태 관리
- TanStack Query: `['conversations']`, `['jobs']`, `['job', id]`, `['notifications']`, `['vehicles', filter]`, `['settings']`. 시트 기반 쿼리는 `staleTime: 30_000`.
- `finalize_job` 카드가 `output-available`이 되면 `['jobs']`, `['notifications']`, `['vehicles']` invalidate.

---

## 9. Phase별 작업

### Phase 0 — 기반 정리

- [x] **0.1** 루트 `git init`, 루트 `.gitignore`(`node_modules`, `.env`, `.dev.vars*`, `.wrangler`, `dist`, 서비스 계정 키 파일 패턴 `*-sa-key.json`). `frontend/.git`이 있으므로 중첩 저장소 처리 방법을 사용자에게 먼저 물어봄.
- [x] **0.2** Worker 이름: `trimsheet-backend`, `trimsheet-frontend`. (🔎 배포 이력 확인)
- [x] **0.3** 두 `wrangler.jsonc`: `compatibility_date: "2026-11-08"`(설치된 workerd가 지원하는 최신 날짜), `observability: { "enabled": true, "traces": { "enabled": true } }`.
- [x] **0.4** `backend` 의존성: `npm i valibot unpdf pdf-lib @cloudflare/playwright` / `npm i -D vitest @cloudflare/vitest-pool-workers`. (🔎 vitest-pool-workers와 Vite 8 호환, valibot 버전이 Flue와 맞는지)
- [ ] **0.5** (→ Phase 9.11) R2 버킷 생성(사용자 로그인 필요 — 안 돼 있으면 `npx wrangler login`을 요청하고 멈춤): `npx wrangler r2 bucket create trimsheet-files`.
- [x] **0.6** `backend/wrangler.jsonc`:
  ```jsonc
  {
    "$schema": "./node_modules/wrangler/config-schema.json",
    "name": "trimsheet-backend",
    "compatibility_date": "2026-11-08",
    "compatibility_flags": ["nodejs_compat"],
    "observability": { "enabled": true, "traces": { "enabled": true } },
    "ai": { "binding": "AI", "remote": true },
    "r2_buckets": [{ "binding": "FILES", "bucket_name": "trimsheet-files" }],
    "browser": { "binding": "BROWSER" },          // Phase 5부터 사용
    "triggers": { "crons": ["0 0 * * 1"] },       // 매주 월 00:00 UTC = 09:00 KST (Phase 6부터)
    "vars": { "GOOGLE_SPREADSHEET_ID": "" },      // Phase 1.0 이후 사용자가 채움 (비밀값 아님)
    // "limits": { "cpu_ms": 300000 },            // 🔎 유료 플랜이면 PDF 파싱용 상향
    "migrations": [
      { "tag": "v1", "new_sqlite_classes": ["FlueTrimSheetAgent"] }
    ]
  }
  ```
  - 배포 이력이 없으면 `FlueHelloAgent` v1을 교체, 있으면 v2에 `deleted_classes: ["FlueHelloAgent"]`.
  - 🔎 `flueWorkerConfig()`가 이 설정을 병합하는지 `vite build` 결과로 확인.
- [x] **0.7** 비밀값 정리: `backend/.env`에 `OPENAI_API_KEY=`, `GOOGLE_SERVICE_ACCOUNT_EMAIL=`, `GOOGLE_PRIVATE_KEY=` 자리 추가(값은 사용자가 입력). 쓰지 않는 `ANTHROPIC_API_KEY`는 삭제 여부를 사용자에게 물어봄. `backend/.env.example`에 키 이름만.
- [x] **0.8** `backend/package.json` 스크립트: `"cf-typegen": "wrangler types"`, `"test": "vitest run"`, `"test:llm": "vitest run --project llm"`. `npm run cf-typegen` → `worker-configuration.d.ts`를 tsconfig에 추가.
- [x] **0.9** 백엔드 dev 포트 `5174` (`vite.config.ts` `server.port`).
- [x] **0.10** `frontend/wrangler.jsonc`에 `"services": [{ "binding": "BACKEND", "service": "trimsheet-backend" }]`, `npm run cf-typegen`.
- [x] **0.11** `frontend/worker/index.ts` 프록시:
  ```ts
  export default {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) {
        return env.BACKEND.fetch(request);   // SSE 스트림을 버퍼링하지 않고 그대로 반환
      }
      return new Response(null, { status: 404 });
    },
  } satisfies ExportedHandler<Env>;
  ```
- [x] **0.12** 로컬 연결 확인: 백엔드·프론트 dev를 각각 띄우고 `curl localhost:5173/api/health`. 🔎 Vite plugin dev registry로 서비스 바인딩이 연결되는지, 안 되면 `server.proxy: { '/api': 'http://localhost:5174' }`로 대체(SSE 통과 확인).
- [x] **0.13** `shared/types.ts` + 두 tsconfig `paths: { "@shared/*": ["../shared/*"] }`(프론트 Vite `resolve.alias`). 타입만 export.
- [x] **0.14** 🔎 Workers AI 로컬 개발: `AI` 바인딩이 로컬에서도 실제 Cloudflare에 요청(과금)되는지 확인하고 사용자에게 알림.

**완료 조건**: `curl http://localhost:5173/api/health` → `{"ok":true,...}` (frontend 경유), 두 프로젝트 타입체크 통과.

---

### Phase 1 — 저장소 기반 (Google Sheets + R2) 와 REST 골격

- [x] **1.0** **Google Sheets 설정 안내 작성 → 사용자에게 전달하고 기다림.**
  - `docs/google-sheets-setup.md`를 작성: Google Cloud 프로젝트 생성 → Google Sheets API 사용 설정 → 서비스 계정 생성 → JSON 키 발급 → 빈 스프레드시트 생성 → 서비스 계정 이메일을 **편집자**로 공유 → 스프레드시트 ID 확인(URL의 `/d/<ID>/`) → `backend/.env`와 `wrangler.jsonc` `vars`에 값 입력 → 배포 시 `wrangler secret put`. 키 파일을 저장소에 넣지 말라는 경고 포함.
  - 사용자에게 문서를 알리고, 설정이 끝날 때까지는 `sheets/memory.ts`로 개발을 계속합니다(막히지 않도록).
- [x] **1.1** `src/shared/*`: `env.ts`(`getEnv()`), `ids.ts`, `errors.ts`(`AppError` + Hono `onError`), `log.ts`(JSON 로그), `config.ts`(§6.2, §7.11 `SCAN_POLICY`).
- [x] **1.2** `src/store/r2.ts`: `putPdf`, `getPdf`, `getPdfStream`, `readState`/`writeState`(조건부 put), `acquireVehicleLock`/`releaseVehicleLock`, `putJson`/`getJson`.
- [x] **1.3** `src/sheets/layout.ts`(§4.1), `auth.ts`, `client.ts`(§7.9), `rows.ts`, `bootstrap.ts`(`ensureLayout`, `_설정` 초기값 `baseline_done=FALSE`), `repo.ts`(작업/항목/차량/PDF목록/대화/알림/스캔기록/설정), `memory.ts`(`SheetsPort` 메모리 구현).
  - `repo.ts`는 `SheetsPort` 인터페이스에만 의존. `getSheets(env)`가 `GOOGLE_SPREADSHEET_ID` 유무로 실제/메모리 구현을 고름.
- [x] **1.4** 단위 테스트: `rows.ts` 변환, `auth.ts` JWT 생성(테스트 안에서 `crypto.subtle.generateKey`로 RSA 키를 만들어 서명 검증), `repo.ts`(메모리 구현: 대화 생성·목록, 항목 상태 변경, 차량 upsert, 같은 차량키 재처리 시 이전 행 삭제).
- [x] **1.5** `src/routes/*` — conversations, uploads, files, jobs(조회), notifications, settings, health. 입력 검증은 valibot.
  - `uploads`: `formData()` → `%PDF` 매직바이트, ≤ 50MB → sha256 → R2(이미 있으면 생략) → `unpdf`로 페이지 수 → `PDF목록` 행(없을 때만) → `alreadyKnown` 반환.
  - `files`: `pdf/` 접두사만 허용, R2 스트림 반환, `content-disposition: inline`.
- [x] **1.6** `src/app.ts` 재작성: Hello 제거, 라우트 마운트, `app.route('/api/agents/trimsheet', createAgentRouter(TrimSheet))`. `hello.ts` 삭제.
- [x] **1.7** 임시 `TrimSheet`(도구 없이)로 GLM 대화 확인: `curl -X POST localhost:5174/api/agents/trimsheet/test-1 -H 'content-type: application/json' -d '{"kind":"user","body":"안녕"}'`.
- [ ] **1.8** (→ Phase 9.1) 사용자가 Sheets 설정을 마쳤다면: `/api/health`가 `sheets: 'ok'`, 첫 호출에 탭·헤더가 자동 생성되는지 실제 시트로 확인.

**완료 조건**: PDF 업로드 → R2 저장 + (설정된 경우) `PDF목록` 탭에 행 추가, 같은 파일 재업로드 시 `alreadyKnown: true`, GLM이 채팅에 응답, 테스트 통과.

---

### Phase 2 — 최소 기능 ①: PDF 1개 → Google Sheets (1차 추출 + 중복 판정)

> 기획서: "이게 되지 않으면 나머지는 의미가 없으므로 가장 먼저 만듭니다."

- [ ] **2.0** (→ Phase 9.2) 🔎 스파이크(1시간 이내), 결과를 결정 기록에:
  - `unpdf` 텍스트·좌표 추출이 workerd에서 동작하는지.
  - GLM-4.7-Flash에 Flue `harness.prompt({ result })`로 구조화 결과(트림 20개 분량의 JSON)를 요청해 **잘리지 않고** 스키마를 통과하는지(§6.2).
  - `openai/<model>`에 `documents`로 PDF를 주고 같은 스키마 결과를 받는지(`OPENAI_API_KEY` 있을 때).
- [ ] **2.1** (→ Phase 9.2) 테스트 PDF: 사용자에게 "더 뉴 스타리아 Electric" 가격표 PDF를 `backend/fixtures/pdf/`에 넣어 달라고 요청. 없으면 공개된 현대 가격표 PDF 1개로 대체. **같은 차종의 이전 연식 PDF가 있으면 함께 받아 R2(이전 연식) 테스트에 사용.**
- [x] **2.2** `pipeline/schema.ts`, `normalize.ts` + 테스트(`parsePrice` 표기 10종, `normName`).
- [x] **2.3** `pipeline/identity.ts` + 표 기반 테스트(파일명·표지 문구 20개 이상: 연식, 계열 키, 기준일).
- [x] **2.4** `pipeline/dedup.ts` + 표 기반 테스트(§7.11 R1~R11 + 예시 시나리오 전부).
- [x] **2.5** `pipeline/pdf-text.ts`, `pdf-layout.ts`, `structure.ts`, `pdf-subset.ts` + 테스트(fixture 스냅샷).
- [x] **2.6** `pipeline/prompts.ts`: Pass A 섹션 프롬프트 3개(§6.5).
- [x] **2.7** `pipeline/extract.ts`(모델 선택·폴백 F1~F5), `quality.ts` + 테스트(폴백 판단은 순수 함수로 분리).
- [x] **2.8** `pipeline/validate.ts`, `evidence.ts` + 테스트.
- [x] **2.9** `pipeline/reconcile.ts` 단일 패스 모드 + 테스트.
- [x] **2.10** `sheets/repo.ts` `writeJobResult`(§7.8) + 메모리 구현 테스트.
- [x] **2.11** 도구: `register_pdf_url`(L1·L2), `prepare_source`(L3, `force`, 잠금), `extract_pass`(A만 + Pass A 직후 L3 재확인), `finalize_job`(`차량` 탭 갱신, 잠금 해제), `get_job`, `search_vehicles`. 모두 `nextStep` 반환, `progressNote` 갱신, `log.info`.
  - `extract_pass`: 섹션별 `step.do('section:<name>:<model>', …)` 안에서 `harness.prompt` + R2 저장 후 **키만** 반환. 폴백 재시도는 다른 step 이름으로.
- [ ] **2.12** (→ Phase 9.3) `TrimSheet` 연결 + 시스템 프롬프트(§6.3). **같은 PDF로 10회** 대화 실행해 도구 순서 이탈 횟수 기록 → 3회 이상이면 단일 도구 모드(§6.4)로 전환.
- [ ] **2.13** (→ Phase 9.4) 중복 시나리오 수동 확인: (a) 같은 PDF를 두 번 올리면 두 번째는 건너뛰고 기존 결과 링크 안내, (b) 이전 연식 PDF를 올리면 "최신 연식이 있다"며 건너뜀, (c) "그래도 정리해 줘" → `force`로 처리되고 시트의 같은 차량키 행이 교체됨.
- [x] **2.14** `scripts/smoke.sh`: 업로드 → 메시지 → 대기 → 시트(또는 메모리) 결과 확인 → 같은 파일 재업로드 시 건너뜀 확인.
- [ ] **2.15** (→ Phase 9.5) CPU/시간 측정: `prepare_source`·`finalize_job` CPU 시간. 무료 플랜 한도를 넘으면 `limits.cpu_ms` 상향 필요성을 사용자에게 알림.

**완료 조건**: fixture PDF 1개로 대화 한 번에 Google Sheets의 데이터 탭·`차량`·`작업` 탭에 행이 생기고, 모든 행에 근거 페이지가, 규칙 행에 각주 원문이 들어 있다. 같은 PDF·이전 연식 PDF는 LLM 호출 없이 건너뛴다.

---

### Phase 3 — 프론트엔드 MVP (대화 + 업로드 + 결과 카드)

- [x] **3.1** 패키지 설치(§8.1), `tailwindcss()` 플러그인, `styles/index.css`(§8.2). 스캐폴드 파일(`App.tsx`, `App.css`, `index.css`, `assets/*`, `public/icons.svg`) 제거. `index.html` `<title>TrimSheet</title>`, `lang="ko"`, primary 색 "T" 파비콘.
- [x] **3.2** `components/ui/*`(Button, Badge, Card, Tabs, Dialog(`<dialog>`), Spinner, EmptyState, Toast).
- [x] **3.3** `router.tsx` + `AppLayout`(§8.3), 시트 미설정 배너.
- [x] **3.4** `lib/api.ts`(타입 fetch 래퍼), `lib/file.ts`(업로드), `lib/labels.ts`(사유·상태·판정 한국어).
- [x] **3.5** `Sidebar`(대화 목록, 새 작업, 이름 변경/삭제, `Google Sheets 열기`).
- [x] **3.6** `HomePage`.
- [x] **3.7** `ChatPage` + `chat/*` + 도구 카드(`prepare_source`, `SkippedCard`, `extract_pass`, `finalize_job`) + Generic(§8.3 ②).
- [x] **3.8** `JobsPage`.
- [x] **3.9** 빈 상태/오류 상태(대화 없음, 연결 실패, 업로드 실패, 시트 반영 실패).
- [ ] **3.10** (→ Phase 9.2) 내장 브라우저로 확인: PDF 드래그 → 도구 카드 진행 → 결과 카드 → `Google Sheets에서 보기`. 같은 PDF 재업로드 → `SkippedCard` → `그래도 정리하기`. 새로고침 후 대화 복원(`historyReady`).

**완료 조건**: 브라우저에서 PDF를 올리면 Google Sheets에 결과가 올라가고, 중복 PDF는 건너뛴다는 카드가 뜨며, 메인 컬러 `#3742fa`가 버튼·사용자 말풍선·로고·활성 메뉴·시트 헤더에 일관되게 적용됨.

---

### Phase 4 — 최소 기능 ②: 교차검증 + "확인 필요" + 검토 화면

- [x] **4.0** 🔎 스파이크: 두 `extract_pass` 호출이 scratch 대화를 공유하지 않는지 확인. 공유되면 `extract-direct.ts`(B는 `env.AI.run` 직접 호출)로 구현.
- [x] **4.1** Pass B 프롬프트(각주 우선, `pages.json` 입력).
- [x] **4.2** `extract_pass` B 허용, `pass_a_done → pass_b_done`.
- [x] **4.3** `reconcile.ts` 2패스 모드 + 테스트(일치/불일치/한쪽만/집합 순서 무관).
- [x] **4.4** `finalize_job`이 A·B 모두 요구, 시스템 프롬프트·`nextStep` 갱신.
- [x] **4.5** 스캔본: F1로 두 패스 모두 OpenAI. 키가 없으면 "스캔본이라 처리할 수 없음" 안내 후 `failed`(잠금 해제).
- [x] **4.6** 가격표 아님: Pass A `isPriceSheet=false` && `looksLikePriceSheet=false` → B 생략, `outcome='not_pricesheet'`, 시트에는 `작업`·`PDF목록`(판정 "가격표 아님")만.
- [x] **4.7** `확인필요` 탭 채우기(1차/2차 값은 사람이 읽는 요약 문자열).
- [x] **4.8** REST: `PATCH /api/jobs/:id/items/:itemId`, `POST /api/jobs/:id/approve-all-auto`.
- [x] **4.9** `JobDetailPage`(§8.3 ④): 탭, 행 액션, `EditItemDialog`, `PdfViewer`, 시트에서 직접 고친 값이 다시 읽히는지 확인.

**완료 조건**: 같은 PDF로 2패스 추출 → 불일치 항목만 `확인 필요`로 시트에 표시 → 앱 화면 또는 시트에서 승인/수정 → 양쪽에 같은 결과가 보임.

---

### Phase 5 — 최소 기능 ③: 차종 페이지 URL → PDF 다운로드

- [x] **5.1** 🔎 Browser Run [Playwright 가이드](https://developers.cloudflare.com/browser-run/playwright/index.md), [Wrangler 레퍼런스](https://developers.cloudflare.com/browser-run/reference/wrangler/index.md), [limits](https://developers.cloudflare.com/browser-run/limits/index.md) 확인 → 결정 기록.
- [x] **5.2** `crawl/browser.ts`: `withPage(env.BROWSER, fn)` — `finally`에서 `browser.close()`, 네비게이션 타임아웃 30초.
- [x] **5.3** `crawl/generic.ts` `findPdfLinks(url)`: `a[href]` 중 `.pdf` 또는 `가격표|카탈로그|가격|price|catalog` 텍스트, `application/pdf` 네트워크 응답, "가격표" 버튼 최대 3개 클릭 후 새 링크/다운로드 이벤트 → `{ url, label, guessKind }[]`(중복 제거). "지난 가격표/이전 가격표/아카이브" 문구가 붙은 링크는 제외.
- [x] **5.4** 후보마다 `identity.ts`로 연식 파싱 → 계열별 최신 연식만 남김(§7.11) → 남은 후보에 L1(URL 지문) 적용.
- [x] **5.5** 도구 `find_pdfs_on_page` + 시스템 프롬프트 갱신(가격표 후보 1개면 바로 `register_pdf_url`, 여러 개면 사용자 선택 → `PdfCandidatesCard`).
- [x] **5.6** 실패 처리: `{ candidates: [], failure: '링크 없음' | '사이트 구조 변경 의심' | '접속 실패' }` → "PDF를 직접 올려 달라" 안내.
- [x] **5.7** 현대/기아/제네시스 차종 페이지 각 1개 수동 테스트 → `docs/site-notes.md`(URL 패턴, PDF 링크 위치, 클릭 필요 여부, **연식 표기 위치**, 이전 연식 가격표가 같은 페이지에 노출되는지).

**완료 조건**: 차종 페이지 URL을 채팅에 붙여 넣으면 최신 연식 가격표만 수집되어 시트까지 반영되고, 이미 처리한 차종이면 건너뜀.

---

### Phase 6 — 최소 기능 ④: 3사 전체 스캔 + 신규 감지 + 주간 자동 실행 + 알림

- [x] **6.1** `crawl/adapters/types.ts`:
  ```ts
  export interface BrandAdapter {
    brand: 'hyundai' | 'kia' | 'genesis';
    /** 현재 판매 라인업 페이지에 있는 차종만. 단종/아카이브/상용 제외 */
    listCurrentVehicles(page: Page): Promise<{ name: string; pageUrl: string }[]>;
    findPriceSheets(page: Page, vehiclePageUrl: string): Promise<{ url: string; label: string }[]>;
  }
  ```
- [x] **6.2** 브랜드별 어댑터 3개(`docs/site-notes.md` 근거). 셀렉터는 파일 상단 상수. 못 찾으면 `failure: '사이트 구조 변경 의심'`. 상용차(포터, 봉고, 트럭/버스)는 이름 패턴으로 제외.
- [x] **6.3** `scan_brand` 흐름(차종 단위 `step.do`):
  1. `listCurrentVehicles` → 차종마다 `findPriceSheets` → 링크 문구·파일명으로 연식 파싱 → **계열별 최신 연식 1개만** 남김.
  2. L1(URL 지문, `HEAD`) → 같으면 건너뜀(다운로드 없음).
  3. 다운로드 → L2(sha) → `prepare_source`와 같은 L3 판정을 텍스트 정규식으로(LLM 없이) 실행.
  4. 판정별로 모음: `process` / `baseline` / `skip` / `hold` / `update_candidate`.
  5. **상한 검사**: `process`가 `maxAutoProcessPerScan` 초과면 전부 `hold`로 바꿈.
  6. `baseline`·`hold`·`update_candidate`·`skip`은 `차량`·`PDF목록` 탭에 상태와 사유만 기록. `process`만 TrimSheet 대화 생성 + dispatch.
  7. 요청 간 1초 지연, 브라우저 세션 1개.
- [x] **6.4** `Watcher` 에이전트 + wrangler 마이그레이션 새 태그 `FlueWatcherAgent`.
- [x] **6.5** `src/cloudflare.ts`:
  ```ts
  import { dispatch } from '@flue/runtime';
  import { Watcher } from './agents/watcher.ts';
  import { startScanRun } from './sheets/repo.ts';

  export default {
    async scheduled(controller, env) {
      // 스캔 기록 행과 모드(기준선/일반)는 여기서 정한다: Watcher가 실패해도 기록이 남도록
      const { scanRunId, mode } = await startScanRun(env, 'cron');   // mode: 'baseline' | 'normal'
      await dispatch(Watcher, {
        id: `scan-${new Date(controller.scheduledTime).toISOString().slice(0, 10)}`,
        message: {
          kind: 'signal', type: 'weekly_scan',
          body: '세 브랜드 홈페이지에서 새 가격표를 확인하세요.',
          attributes: { scanRunId, mode, cron: controller.cron },
        },
      });
    },
  } satisfies ExportedHandler<Env>;
  ```
  - `startScanRun`은 `_설정` `baseline_done`이 `FALSE`이고 `initialScanMode === 'baseline_only'`이면 `mode='baseline'`. 기준선 스캔이 **실패 없이** 끝나면 `baseline_done=TRUE`(일부 브랜드가 실패하면 다음 스캔도 기준선 모드로 그 브랜드만 다시).
  - `POST /api/scan-runs`도 같은 흐름(`trigger: 'manual'`, id에 시각 포함).
- [x] **6.6** 처리 대상 PDF별 TrimSheet 대화 자동 생성(🔎 dispatch 위치 검증 → 필요 시 Queues).
- [x] **6.7** `POST /api/vehicles/:key/process`(기준선/갱신 후보/보류 → `force` 처리), `POST /api/vehicles/:key/dismiss`.
- [x] **6.8** 알림: `_알림` 탭에 `scan_done`(처리·기준선·갱신 후보·보류 수 요약)/`scan_failed`/`job_done`/`job_failed`. 프론트 `NotificationBell`.
- [x] **6.9** `SourcesPage`(§8.3 ⑤) + `GET /api/vehicles`, `GET/POST /api/scan-runs`.
- [ ] **6.10** (→ Phase 9.9) 🔎 로컬에서 scheduled 핸들러 트리거 방법 확인(`/cdn-cgi/handler/scheduled` 지원 여부). 안 되면 수동 실행 API로 검증.
- [x] **6.11** 시나리오 검증(메모리 시트 + 가짜 어댑터로 자동화 테스트):
  - 첫 스캔: 모든 차량이 `기준선`, LLM 호출 0회, `baseline_done=TRUE`.
  - 두 번째 스캔(변화 없음): L1에서 전부 건너뜀, 다운로드 0회.
  - 신차 1개 추가: 그 1개만 `process`.
  - 한 차종이 2025→2026으로 바뀜: 2026만 `process`, 2025 행은 `이전 연식`.
  - 같은 연식 가격표만 바뀜(기준일이 더 새로움): `process`(자동 갱신), 처리 후 그 차량의 데이터 행이 새 작업ID로 교체되고 `작업` 탭에는 이전 작업이 남음.
  - 같은 연식, 파일만 다르고 기준일이 같음: `skip`(R3). 기준일을 못 읽음: `hold`(R4b).
  - 신규가 12개 감지: 전부 `보류` + "너무 많음" 알림.

**완료 조건**: 첫 "지금 확인"은 현재 판매 차종을 기준선으로 등록만 하고(LLM 호출 없음), 이후 스캔에서는 신차·신규 연식만 처리되며, 이전 연식과 이미 처리한 차량은 다운로드조차 하지 않는다. 판정 사유는 시트와 수집 현황 화면에서 보인다.

---

### Phase 7 — 최소 기능 ⑤: 헥사코드 근사값

- [ ] **7.1** (→ Phase 9.7) 🔎 fixture PDF 3개에서 색상 칩이 래스터 이미지인지 확인(§7.10).
- [x] **7.2** `pipeline/hex.ts` + 테스트(단색 → 정확한 hex, 그라데이션/사진 → 제외).
- [x] **7.3** `finalize_job`에 hex 단계: 출처(`이미지`/`OpenAI 추정`/없음)를 `헥사 출처` 열에.
- [x] **7.4** 시트 `미리보기` 셀 배경색, 검토 화면 칩 + "근사값", `확인필요` 탭에 "헥사코드 근사값 N개 확인" 1줄.

**완료 조건**: 색상 탭에 hex·출처가 채워지고 미리보기 셀이 해당 색으로 칠해짐(추출 불가한 칩은 비어 있고 확인 필요로 표시).

---

### Phase 8 — 평가 도구와 배포 준비

> 2026-11-10 개정: 실제 데이터가 필요한 실행(정확도 측정, 배포, 접근 보호 적용)은 **Phase 9**로 옮겼습니다. Phase 8은 그 실행에 필요한 도구와 문서를 준비합니다.

- [x] **8.1** 정답 데이터 변환 도구: `backend/src/eval/golden.ts` + `npm run golden -- <csv-폴더> <out.json> [차종]`. 시트 탭과 같은 열 구성의 CSV(`트림.csv`·`색상.csv`·`선택품목.csv`·`옵션규칙.csv`)를 읽고 `상태=제외` 행은 뺌.
- [x] **8.2** 평가 도구: `backend/src/eval/metrics.ts`(자동 확정 정확도, 트림·옵션 누락/가격 오류, 규칙 재현율, 시트별 누락·값 다름) + `npm run eval -- <jobId>=<golden.json> ...` → `backend/eval-report.md`. 결과는 새 API `GET /api/jobs/:id/report`(R2 `report.json`)에서 읽음 — 모델 호출 없음. 목표 미달이면 종료 코드 2.
- [x] **8.3** (실행은 9.10) 목표 미달 시 조정 절차를 Phase 9에 정의.
- [x] **8.4** 배포 준비: 백엔드 `workers_dev: false`·`preview_urls: false`(공개 URL 없음, 서비스 바인딩으로만 접근), 루트 `scripts/deploy.sh`(Node·로그인·R2 버킷·비밀값 확인 → 테스트·빌드 → 백엔드→프론트엔드 순 배포), 안내서 `docs/deploy.md`. (실제 배포는 9.11)
- [x] **8.5** 접근 보호 안내: `docs/deploy.md` §4(Cloudflare Access로 본인 이메일만 허용). (적용 여부 결정과 적용은 9.11)
- [x] **8.6** 루트 `README.md`: 구조, 로컬 실행, 환경 변수, 테스트·평가, 배포, 동작 규칙 요약.

**완료 조건**: 평가·배포 도구가 테스트되고(백엔드 테스트 156개), 사용자가 Phase 9.0 준비물만 채우면 바로 확인 작업을 시작할 수 있다.

---

### Phase 9 — 실제 데이터 확인과 배포

> Phase 0~8에서 **실제 데이터·유료 서비스가 필요해 미뤄 둔 확인**을 모두 여기서 합니다. 시작 조건은 9.0입니다. 각 단계는 "통과 기준"을 만족해야 다음으로 넘어가고, 실패하면 report.md의 대안대로 고친 뒤 다시 확인합니다. 비용이 드는 단계는 ⚡ 표시 — 실행 전 대략의 호출 수를 사용자에게 알립니다.

- [ ] **9.0 준비물 (사용자)** — 모두 준비되면 시작
  - 실제 가격표 PDF 1개 이상 → `backend/fixtures/pdf/` (같은 차종의 이전 연식 PDF가 있으면 함께)
  - Google Sheets 연결 → `docs/google-sheets-setup.md` (`backend/.env` 2개 값 + `wrangler.jsonc` `vars.GOOGLE_SPREADSHEET_ID`)
  - (선택) `OPENAI_API_KEY` → `backend/.env`
  - R2 활성화(대시보드) — 9.11 전까지
  - 정답 데이터 3종(CSV, 시트와 같은 열 구성) — 9.10 전까지
  - 결정: 배포 후 Cloudflare Access 적용 여부(9.11)
- [ ] **9.1 Google Sheets 연결** (← 1.8) — dev 서버 재시작 후 `GET /api/health`가 `sheets: "ok"`, 스프레드시트에 탭 12개(숨김 3개)와 헤더·드롭다운이 생성됨. 화면의 노란 배너가 사라짐.
- [ ] **9.2 ⚡ 실제 PDF 1개 처리** (← 2.0, 2.1, 3.10) — 화면에서 PDF를 올려 대화 1회. 예상 GLM 호출 ≈ 대화 4~6턴 + 추출 6회.
  - 통과 기준: 도구 카드가 분석→1차→2차→마감 순서로 진행, 결과 카드가 뜨고 시트 탭에 행이 생김, 모든 행에 근거 페이지, 규칙 행에 각주 원문.
  - 함께 확인: GLM 구조화 출력이 스키마를 통과하는지, 도구 안 `cloudflare:workers` env 접근(`shared/env.ts` TODO), 폴백이 필요한 경우 OpenAI 모델 ID(`shared/config.ts` TODO). 결과를 결정 기록에.
  - 실패 시: report.md §4-2의 대안(섹션 분할, JSON 모드, 단일 도구 모드, env 접근 방식 교체).
- [ ] **9.3 ⚡ 도구 순서 안정성** (← 2.12) — 같은 PDF로 2회 더 실행(첫 판정). 순서 이탈이 있으면 사용자 동의 후 10회까지 늘려 측정. 3/10 이상 이탈이면 단일 도구 모드 전환.
- [ ] **9.4 중복·연식 시나리오** (← 2.13) — (a) 같은 PDF 재업로드 → 모델 호출 없이 건너뜀 카드, (b) 이전 연식 PDF → "이전 연식" 건너뜀, (c) "그래도 정리해 줘" → force로 처리되고 시트의 같은 차량 행이 교체됨.
- [ ] **9.5 CPU·시간 측정** (← 2.15) — Workers Logs/Traces에서 `prepare_source`·`finalize_job`의 CPU 시간 확인. 무료 플랜 한도를 넘으면 `limits.cpu_ms` 상향(유료 플랜) 여부를 사용자에게 묻기.
- [ ] **9.6 검토 화면** (← Phase 4 실데이터) — 실제 결과로 승인·수정·제외, 일괄 승인, 근거 클릭 시 PDF 페이지 이동, 시트에서 직접 고친 값이 화면에 반영되는지.
- [ ] **9.7 헥사코드** (← 7.1) — 실제 PDF의 색상 칩이 벡터/이미지 중 무엇인지, `PDF 칩` 출처로 채워진 비율. 짝짓기가 틀리면 거리 기준(`hex.ts` `matchChips`) 조정 + 테스트 추가.
- [ ] **9.8 ⚡ 차종 페이지에서 PDF 찾기** (← 5.6 실행) — 현대·기아·제네시스 차종(또는 목록) 페이지 URL을 각각 채팅에 붙여 `find_pdfs_on_page` 결과 확인. Browser Run은 현대·기아에서만 사용. 실패 시 `docs/site-notes.md`·어댑터 선택자 수정.
- [ ] **9.9 ⚡ 첫 스캔(기준선)과 cron** (← 6.10) — 수집 현황에서 "지금 확인" 1회.
  - 통과 기준: 세 브랜드 차량이 `기준선`으로 등록, AI 처리 0건, `_설정 baseline_done=TRUE`, 스캔 기록·알림 생성, 상용차 제외.
  - 함께 확인: 제네시스 POST 다운로드, 현대 PDF 주소 규칙(404 차종), 연식 미상 → 보류 비율(높으면 연식 판단 규칙 보강), Watcher 도구 안에서 `dispatch` 동작.
  - 로컬 scheduled 트리거: Vite dev에서 `/cdn-cgi/handler/scheduled` 지원 여부 확인, 안 되면 배포 후 대시보드에서 확인.
- [ ] **9.10 ⚡ 정확도 평가** (← 8.1~8.3 실행) — 정답 3종을 `npm run golden`으로 변환 → 같은 3개 PDF 처리 → `npm run eval`.
  - 통과 기준: 자동 확정 정확도 ≥ 99%, 트림·가격·옵션 누락 0, 규칙 재현율 ≥ 95%.
  - 미달 시: 프롬프트·표 복원·검증 규칙 조정 후 재평가. 그래도 미달이면 "2차 추출을 OpenAI로 고정" 여부를 사용자에게 묻고 결정 기록.
- [ ] **9.11 배포와 접근 보호** (← 0.5, 8.4, 8.5) — R2 버킷 생성 → `wrangler secret put` → `./scripts/deploy.sh` → 배포 URL에서 업로드→시트 반영, Logs/Traces 오류 없음, cron 등록 확인, 첫 cron 전 `baseline_done` 확인. 사용자가 결정했으면 Cloudflare Access 적용 후 시크릿 창으로 차단 확인.
- [ ] **9.12 마무리** — report.md 갱신(남은 위험·결정), 우회 항목 정리 가능 여부 확인(pi-ai 버전 고정 해제, compatibility_date 갱신, 번들 크기), 커밋·푸시.

**완료 조건**: 9.1~9.11 통과 기준을 모두 만족하고, 배포된 앱에서 실제 가격표가 Google Sheets까지 정리된다.

## 10. 테스트 전략

| 층 | 도구 | 대상 |
| --- | --- | --- |
| 단위 | Vitest (workers pool) | `pipeline/*`(특히 `identity`, `dedup`), `sheets/rows`, `sheets/auth`, `sheets/repo`(메모리 구현), `store/r2` |
| 라우트 | Vitest + `SELF.fetch` | `/api/uploads`, `/api/files`, `/api/jobs` PATCH, `/api/vehicles/:key/process` (Sheets는 메모리 구현) |
| 스캔 시나리오 | Vitest + 가짜 어댑터 + 메모리 시트 | Phase 6.11의 6개 시나리오 |
| 에이전트 통합 | 로컬 dev + `scripts/smoke.sh` | 업로드 → 대화 → 시트, 재업로드 건너뜀 |
| 정확도 | `scripts/eval.ts` | 정답 데이터 3종 |
| UI | 내장 브라우저 수동 확인 (+ 선택: Playwright E2E 1개) | 핵심 흐름 |

- LLM·실제 Google API 호출 테스트는 기본 `npm test`에서 제외(`*.llm.test.ts`, `*.google.test.ts` → `npm run test:llm`).
- reconcile/validate 테스트용 가짜 추출 결과: `fixtures/extractions/*.json`.

---

## 11. 위험과 대응

| 위험 | 대응 |
| --- | --- |
| 첫 실행에 과거·전체 차량을 대량 수집 | 현재 라인업만 탐색, 계열별 최신 연식만, 첫 스캔은 기준선 등록만, 스캔당 자동 처리 상한(§7.11) |
| 연식을 잘못 읽어 최신 연식을 버림 | 연식 불명은 보류(R9), 판정 사유를 시트에 남김, 이전 연식으로 건너뛴 PDF도 `PDF목록`에 남겨 사용자가 `force`로 처리 가능 |
| 계열 키가 달라 같은 차를 다른 차로 인식(중복 처리) | `FAMILY_ALIASES` 표 관리, 스캔당 상한, 신차로 판정된 항목은 알림에 이름이 나오므로 바로 발견 가능 |
| 같은 연식 가격표가 매주 반복 처리됨(파일만 조금 다른 경우) | R4는 기준일이 더 새로울 때만 처리, 기준일이 같으면 건너뜀(R3), 모르면 보류(R4b) |
| 자동 갱신이 사용자의 기존 검토 내용을 덮어씀 | 이전 작업은 `작업` 탭·R2에 남김, 알림에 "기존 검토 내용 교체" 명시 |
| GLM이 PDF 표를 텍스트로만 봐서 병합 셀·열 관계를 잘못 읽음 | 좌표 기반 표 복원(§7.2) + 근거 원문 대조 + 2차 추출 + 품질 점검 실패 시 OpenAI 폴백(F4) |
| GLM 출력 토큰 한도로 JSON이 잘림 | 섹션 분할(§6.5), Phase 2.0 스파이크 확인, 필요 시 더 잘게 분할 |
| GLM의 도구 순서 이탈 | `stage` 검사 + `nextStep` + 10회 측정 후 단일 도구 모드 전환(§6.4) |
| 1·2차 모두 GLM이라 같은 오류가 겹침 | 입력 표현·프롬프트를 다르게, 근거 대조. 목표 미달 시 Pass B를 OpenAI로(사용자 결정) |
| 스캔본 | OpenAI 폴백(F1). 키 없으면 실패로 안내 |
| Sheets API 한도·지연 | 작업당 탭별 쓰기 1회, 지수 백오프, 프론트 캐시. 진행 상태는 R2로 분리 |
| Sheets 동시 수정 충돌 | 행 삭제는 `finalize_job` 때만, 삭제 직전에 행 번호를 다시 읽음. 같은 차량 동시 처리는 R2 잠금으로 차단 |
| 서비스 계정 키 유출 | 비밀값으로만 보관, `.gitignore`, 문서에 값 기록 금지 |
| 제조사 사이트 구조 변경 / 봇 차단 | 셀렉터 상수화, "수집 실패" 알림 후 수동 업로드 유도, 요청 간 지연. 구조 변경으로 모든 차가 신차로 보이면 상한에 걸려 자동 처리되지 않음 |
| Worker CPU 한도 | Phase 2.15 측정, 필요 시 `limits.cpu_ms` 상향(유료 플랜) |
| 긴 LLM 호출로 도구 시간 초과/DO 퇴출 | `durable` + 섹션별 `step.do` + `timeoutMs`. 🔎 Flue durability 가이드에서 submission 제한 시간 확인 |
| 공개 URL 비용 남용 | §8.5 접근 보호 |

---

## 12. 범위 밖 (이번에 하지 않음)

기획서 §4-5에 더해:
- 인증/다중 사용자, 이메일·메신저 알림(앱 내 알림만)
- 관계형 DB(D1 등) — §0.5
- Excel 파일 직접 생성(필요하면 Google Sheets의 `.xlsx` 내려받기 사용)
- 과거 연식·단종 차량 데이터 수집(사용자가 직접 올리고 `force`로 요청한 경우만 예외)
- 서비스 DB 직접 반영, 가격 변동 이력/비교 리포트
- 클라이언트 원본 템플릿 업로드(시트 레이아웃은 `sheets/layout.ts` 상수로만 정의)
- 수입차·상용차·특장차, 수정 내역 학습

---

## 13. 결정 기록 (구현 중 갱신)

| 날짜 | 결정 | 이유 |
| --- | --- | --- |
| 2026-11-09 | 프론트→백엔드는 Service Binding 프록시 (same-origin) | CORS 불필요, 백엔드 공개 URL 끄기 가능 |
| 2026-11-09 | 1·2차 추출을 별도 도구 호출로 분리 | 한 harness 안 `prompt` 반복 호출은 대화를 공유(Flue 문서) |
| 2026-11-09 | PDF는 R2 업로드 후 `[source:id]` 토큰으로 전달 | 대화 첨부 한도(14 MiB)·대화 저장소 비대화 방지, GLM은 문서 입력 미지원 |
| 2026-11-09 | **DB(D1) 제거** — 가공 데이터는 Google Sheets, 파일·작업 상태·잠금은 R2 | 사용자 요청. 개인용 규모에서는 DB 없이 충분(§0.5) |
| 2026-11-09 | 시트는 스프레드시트 1개 + 고정 탭 + 긴 형식(차종을 열로 구분) | 탭 폭증 방지, 필터·DB 반영 용이. 차종별 탭이 필요하면 `layout.ts`만 바꿔 전환 가능 |
| 2026-11-09 | 모델: GLM-4.7-Flash(Workers AI) 기본, OpenAI는 폴백(F1~F5) | 사용자 지정. GLM은 텍스트 전용이라 PDF를 좌표 기반 텍스트로 변환해 입력 |
| 2026-11-09 | 추출을 섹션 3개로 분할 | GLM 출력 토큰 한도 대비 |
| 2026-11-09 | Excel 생성(`exceljs`) 제거 | 결과가 Sheets로 바뀜 |
| 2026-11-09 | 중복 판정 3단계(URL 지문 → 파일 지문 → 차량 판정), 차량 키 = 브랜드+차종 계열+연식 | 비싼 단계(다운로드·LLM) 전에 최대한 걸러냄 |
| 2026-11-09 | 차종별 최신 연식만 수집, 첫 스캔은 기준선 등록만, 스캔당 자동 처리 상한 10 | 사용자 요청(이전 연식·과거 차량 대량 수집 방지) |
| 2026-11-09 | 같은 연식의 새 가격표(R4)는 **자동으로 다시 정리** (`sameYearNewerPriceSheet: 'process'`). 기준일이 더 새로울 때만, 모르면 보류(R4b) | 사용자 결정. 가격 인상 반영이 기획서 목적 |
| 2026-11-09 | 알림은 앱 내 알림(`_알림` 탭)만 | 개인용 |
| 2026-11-09 | 첫 스캔은 **기준선 등록만** (`initialScanMode: 'baseline_only'`) | 사용자 결정. 첫 실행 때 현재 판매 차량 전체를 한꺼번에 처리하지 않음. 기준선 차량은 수집 현황 화면에서 골라 처리 |
| 2026-11-09 | Node 22.23.2 사용 (루트 `.nvmrc`, `.claude/launch.json`) | 기본 Node v21.2는 Wrangler(22+ 필요)가 실행되지 않음 |
| 2026-11-09 | `@earendil-works/pi-ai`, `pi-agent-core`를 `overrides`로 1.4.0 고정 | 1.5.0이 `Type`/`ToolCallArgumentsStream` export를 바꿔 Flue 2.3.0 빌드가 깨짐. Flue가 1.5를 지원하면 해제 |
| 2026-11-09 | `compatibility_date`를 2026-11-08로 | 설치된 workerd가 지원하는 최신 날짜(11-09는 런타임이 거부) |
| 2026-11-09 | Workers AI 바인딩 `remote: true` | 로컬 dev에서도 항상 원격 호출·과금됨(Wrangler 경고 확인) |
| 2026-11-09 | 백엔드 Vite `inspectorPort: 9230` | 프론트·백엔드 dev를 동시에 띄울 때 9229 충돌 |
| 2026-11-09 | 로컬 서비스 바인딩은 Vite plugin dev registry로 동작 확인 (프록시 대안 불필요) | `curl :5173/api/health` → 백엔드 응답, 에이전트 대화도 통과 |
| 2026-11-09 | 단위 테스트는 별도 `vitest.config.ts`(node 환경) | `vite.config.ts`의 Flue·Cloudflare 플러그인을 Vitest가 불러오면 시작 실패. Workers 풀 테스트는 Phase 1.7에서 추가 |
| 2026-11-09 | `frontend/.git`(스캐폴드 커밋 1개) 삭제, 루트 단일 저장소(`main`) | 사용자 결정. 중첩 저장소 방지 |
| 2026-11-09 | REST API를 `src/routes/index.ts`(`api`)로 분리하고 Node 환경 Vitest + 가짜 R2 + 메모리 시트로 테스트 | Flue 런타임·Workers 풀 없이 빠르게 테스트, Cloudflare 과금 없음. Workers 런타임 동작은 로컬 dev 스모크로 확인 |
| 2026-11-09 | `unpdf`가 workerd에서 동작함을 확인(업로드 시 페이지 수 계산) | Phase 2.0 스파이크 항목 일부 해결 |
| 2026-11-09 | Sheets 응답은 `UNFORMATTED_VALUE`로 읽고, 열은 헤더 텍스트로 찾음 | `#,##0` 서식 숫자가 문자열로 오는 문제 방지, 사용자가 열 순서를 바꿔도 안전 |
| 2026-11-09 | 1.7 GLM 대화 확인은 Phase 0에서 이미 완료해 생략 | Workers AI 과금 최소화(사용자 요청) |
| 2026-11-10 | GLM-4.7-Flash는 Pi 카탈로그에 등록됨(컨텍스트·최대 출력 131,072, 텍스트 전용, reasoning) | §6.2의 "출력 잘림" 위험은 낮음. 섹션 분할은 유지 |
| 2026-11-10 | 대화 ID는 업로드 메시지의 `[conversation:<id>]` 토큰으로 전달 | Flue 도구 컨텍스트에서 인스턴스 ID를 읽는 API가 없음 |
| 2026-11-10 | `차량` 탭은 정리가 끝났을 때만 기록(`처리 완료`), 진행 중 중복은 R2 잠금으로 차단 | 중간에 건너뛰거나 실패한 작업이 등록부를 오염시키지 않도록 |
| 2026-11-10 | `PIPELINE.twoPass=false`로 Phase 2는 1차 추출만, Phase 4에서 켬 | 계획 순서 유지, 비용 절감 |
| 2026-11-10 | 도구 흐름 전체를 가짜 모델·가짜 바인딩으로 테스트(`test/tools.test.ts`) | Workers AI 과금 없이 중복·이전 연식·갱신·스캔본 시나리오 검증 |
| 2026-11-10 | 스캔본 판정을 "빈 페이지 비율 ≥ 80%"로 | 표지·안내 페이지가 짧은 정상 가격표를 스캔본으로 오판하지 않도록 |
| 2026-11-10 | 백엔드 번들 gzip ≈ 2.0MB | Workers 무료 플랜 한도(3MB) 안 |
| 2026-11-10 | 프론트: `react-router` v8(라이브러리 모드), TanStack Query, Tailwind v4, Pretendard(CDN) | 계획 §8.1 그대로(라우터만 최신 메이저) |
| 2026-11-10 | 업로드 메시지에 `[source:…] [file:…] [conversation:…]` 토큰, 화면에서는 토큰 대신 파일 칩으로 표시 | 에이전트에 sourceId·대화 ID 전달, 사용자에게는 깔끔하게 |
| 2026-11-10 | 검토 화면(`/jobs/:id`)은 Phase 3에서 읽기 전용으로 먼저 제공(탭·근거 페이지 클릭 시 PDF 이동) | 결과 카드의 "검토하기" 링크가 동작하도록. 승인·수정은 Phase 4 |
| 2026-11-10 | 3.10 실제 대화(도구 카드 진행·결과 카드)는 실제 PDF 실행 때 함께 확인 | Workers AI 과금 최소화. 화면·API·모바일 드로어는 확인 완료 |
| 2026-11-10 | 4.0 해결(AI 호출 없이): Flue는 `harness: true` 도구 호출마다 `createInvocationHarness`로 새 harness를 만들고 실행 후 닫음 | `extract_pass` A·B는 서로의 대화를 보지 못함 → `extract-direct.ts` 불필요 |
| 2026-11-10 | `PIPELINE.twoPass=true`. 가격표가 아니면 2차를 건너뛰고 바로 마감 | 교차검증 활성화, 비용 절약 |
| 2026-11-10 | 검토 수정은 시트별 허용 열만(`sheets/review.ts` `EDITABLE`), 가격·헥사·구분·유형 검증 | 근거·ID·차량 정보가 실수로 바뀌지 않도록 |
| 2026-11-10 | Excel 재생성 버튼 대신 "자동 확정 모두 승인" | 결과가 Sheets로 바뀌어 재생성이 필요 없음 |
| 2026-11-10 | 검토 화면의 실제 데이터 확인은 Sheets·PDF 준비 후 마지막에 | 사용자 요청(데이터 필요한 확인은 마지막에) |
| 2026-11-10 | 사이트 조사 결과(`docs/site-notes.md`): 현대는 slug로 PDF 주소 계산, 기아는 탭 렌더링 필요, 제네시스는 일반 HTML + POST 다운로드 | 내장 브라우저로 직접 확인(PDF는 받지 않음) |
| 2026-11-10 | 브라우저(Browser Run)는 현대·기아 목록에만 사용, 제네시스와 `find_pdfs_on_page`는 일반 HTML을 먼저 시도 | Browser Run 사용 시간(과금) 최소화 |
| 2026-11-10 | Browser Run 세션은 `guardrails.allowedDomains`로 세 제조사 도메인만 허용 | 수집기가 다른 사이트로 새지 않도록 |
| 2026-11-10 | 기아 내부 JSON API(`kwpapi.kia.com`)는 쓰지 않음 | 권한 검사에서 거부됨 — 공개 페이지 렌더링만 사용 |
| 2026-11-10 | 제네시스는 같은 차종의 예전 가격표가 함께 노출 → 파일명 `YYYYMM`으로 slug별 최신만 | 이전 버전 수집 방지(§7.11 요구) |
| 2026-11-10 | 세 사이트 모두 연식이 URL·링크에 없음 → 연식은 PDF 표지(1~2쪽) 텍스트로 판단, 못 읽으면 보류 | 추측 금지 |
| 2026-11-10 | Watcher는 `scan_brands` 도구를 한 번만 호출(세 브랜드를 코드로 순차 처리) | GLM 호출 최소화, 순서 보장 |
| 2026-11-10 | `dispatch`는 도구 안(DO)에서도 동작(런타임 설정은 같은 스크립트에서 로드) → Queues 불필요 | Flue 소스 확인 |
| 2026-11-10 | 백엔드 번들 gzip ≈ 2.73MB (Playwright 포함) | 무료 플랜 한도 3MB에 근접 — 넘으면 유료 플랜 또는 의존성 정리 필요 |
| 2026-11-10 | 5.6(실제 사이트 수동 테스트), 6.10(로컬 cron 트리거)은 데이터 준비 후 마지막에 | 사용자 요청, Browser Run·Workers AI 과금 최소화 |
| 2026-11-10 | 헥사코드: pdf.js 그리기 명령(operator list)에서 **벡터 사각형 칩**(`setFillRGBColor`+`constructPath`)과 **이미지 칩**(`paintImageXObject`+`extractImages` 픽셀 중앙값)을 위치와 함께 찾고, 가장 가까운 색상명과 짝지음 | `extractImages`만으로는 위치를 알 수 없고, 칩이 벡터로 그려진 PDF도 많음. 형식은 pdf.js 6.4에서 직접 확인 |
| 2026-11-10 | 칩 크기 6~150pt·가로세로비 0.4~2.5만 칩으로 인정, 그라데이션·사진 이미지는 제외. 이름 위치를 못 찾으면 같은 페이지의 칩 수와 색상 수가 같을 때만 읽기 순서로 짝지음 | 표 배경·헤더 막대·사진을 칩으로 오인하지 않도록 |
| 2026-11-10 | 헥사 출처: `PDF 칩` / `OpenAI 추정`(폴백 때만) / `사용자 수정`. 확인필요 탭에 작업당 "헥사코드 근사값 N개" 요약 행(승인만 가능) | 근사값임을 항상 드러내고, 검토 부담은 한 줄로 |
| 2026-11-10 | 헥사 추출 실패는 작업을 실패시키지 않음(로그만) | 핵심 데이터(트림·가격·옵션·규칙) 반영이 우선 |
| 2026-11-10 | 7.1(실제 제조사 PDF의 칩 형태 확인)은 데이터 준비 후 마지막에 | 사용자 요청 |
| 2026-11-10 | Phase 8은 평가·배포 **도구와 문서**까지, 실제 확인·배포는 **Phase 9**로 분리 | 사용자 요청(데이터는 Phase 8 직후 제공) |
| 2026-11-10 | 백엔드 `workers_dev: false`·`preview_urls: false` | 공개 URL 없이 서비스 바인딩으로만 접근(비용·보안) |
| 2026-11-10 | `GOOGLE_SPREADSHEET_ID`를 `wrangler.jsonc` vars에서 빼고 `.env`/`wrangler secret`으로 | 공개 저장소에 시트 ID를 남기지 않음 |
| (미정) | Pass B를 OpenAI로 고정할지 | Phase 8 정확도 결과를 보고 사용자가 결정 |
|  |  |  |

---

## 14. 참고 문서

- Flue: <https://flueframework.com/docs/> (터미널: `npx flue docs search <query>`) — Models(Workers AI / OpenAI), Tools, Durability, React(`useFlueAgent`), Cloudflare target, Schedules, Provider API(`cloudflareBindingProvider`)
- Workers AI GLM-4.7-Flash: <https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/> (131,072 토큰, function calling, 텍스트 전용)
- Cloudflare 스킬: `.agents/skills/cloudflare/SKILL.md`, `.agents/skills/workers-best-practices/SKILL.md` 및 `references/`(r2, browser-rendering, cron-triggers, workers-ai)
- Workers best practices: <https://developers.cloudflare.com/workers/best-practices/workers-best-practices/index.md>
- Browser Run: <https://developers.cloudflare.com/browser-run/llms.txt>
- R2 Workers API(조건부 쓰기): <https://developers.cloudflare.com/r2/api/workers/workers-api-reference/>
- Google Sheets API v4: <https://developers.google.com/workspace/sheets/api/reference/rest>
- Google 서비스 계정 OAuth(JWT): <https://developers.google.com/identity/protocols/oauth2/service-account>
- OpenAI 파일(PDF) 입력: <https://platform.openai.com/docs/guides/pdf-files>
