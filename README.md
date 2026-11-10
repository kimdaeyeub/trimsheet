# TrimSheet

현대·기아·제네시스 가격표 PDF에서 **트림·색상·선택 품목·옵션 규칙**을 근거 페이지와 함께 뽑아, 두 번 추출해 교차검증한 뒤 **Google Sheets**에 올리는 개인용 에이전트입니다. 매주 제조사 홈페이지를 확인해 신차·새 연식·새 가격표만 자동으로 정리합니다.

- 에이전트: [Flue](https://flueframework.com) · 모델: Workers AI `@cf/zai-org/glm-4.7-flash` (PDF를 못 읽는 경우에만 OpenAI 폴백)
- 실행 환경: Cloudflare Workers 2개 (`backend`, `frontend`) · 파일: R2 · 데이터: Google Sheets (DB 없음)
- 화면: 시트 데이터를 **차종별로** 보여 주는 한 화면(브랜드·검색·페이지 나눔, 트림·선택 품목·색상·옵션 규칙). 새 데이터가 추가되면 **이메일 알림**을 보냅니다. **새 차종 테스트** 버튼으로 시트에 없는 제네시스 차종 하나를 골라 처음부터 끝까지 정리해 볼 수 있습니다(Workers AI 소액 과금).
- 문서: [PLAN.md](PLAN.md)(설계·결정 기록) · [report.md](report.md)(진행 상황) · [docs/](docs/)(Sheets 연결, 이메일 알림, 배포, 사이트 조사)

## 구조

```
브라우저 ─▶ Vercel (React SPA + /api 프록시 함수)
               │ HTTPS + x-trimsheet-key   (로컬 개발: Cloudflare 프론트엔드 Worker + 서비스 바인딩)
               ▼
           trimsheet-backend (Hono API + Flue 에이전트 TrimSheet·Watcher, cron)
               ├─ Workers AI (GLM-4.7-Flash) / OpenAI (폴백)
               ├─ R2 (PDF, 작업 상태)
               ├─ Browser Run (현대·기아 목록 렌더링)
               ├─ Google Sheets API (결과 저장)
               └─ Email Service (새 데이터 알림 메일)
```

| 폴더 | 내용 |
| --- | --- |
| `backend/src/agents` | Flue 에이전트 `TrimSheet`(대화), `Watcher`(주간 수집) |
| `backend/src/tools` | 에이전트 도구(PDF 찾기·등록·분석·추출·마감·스캔) |
| `backend/src/pipeline` | PDF 텍스트·표 복원, 추출 프롬프트·폴백, 검증, 1·2차 비교, 중복 판정, 헥사코드 |
| `backend/src/sheets` | Google Sheets 연동(서비스 계정 인증, 탭 레이아웃, 읽기·쓰기) |
| `backend/src/crawl`, `backend/src/scan` | 제조사 사이트 수집, 주간 스캔 |
| `backend/src/catalog`, `backend/src/notify`, `backend/src/demo` | 차종별 화면용 데이터(페이지 나눔), 새 데이터 이메일 알림, 새 차종 테스트 |
| `backend/src/eval`, `backend/scripts` | 정확도 평가, 정답 데이터 변환, 스모크 테스트 |
| `frontend/src` | 화면 하나: 구글 시트 데이터를 차종별로 보여 줌(브랜드 필터·검색·페이지 나눔·트림/선택 품목/색상/옵션 규칙 상세) |
| `shared/types.ts` | 프론트·백엔드 공용 타입 |

## 로컬 실행

**Node 22**가 필요합니다(`.nvmrc`).

```bash
nvm use
```

```bash
cd backend && npm install && cd ../frontend && npm install
```

`backend/.env`에 값을 넣습니다(`backend/.env.example` 참고). Google Sheets를 아직 연결하지 않았으면 비워 둬도 됩니다. 이때는 메모리에 임시 저장되고, 화면에 안내 배너가 뜹니다.

| 변수 | 설명 |
| --- | --- |
| `GOOGLE_SPREADSHEET_ID` | 결과를 올릴 스프레드시트 ID (URL의 `/d/<ID>/`) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` | 서비스 계정 ([docs/google-sheets-setup.md](docs/google-sheets-setup.md)) |
| `OPENAI_API_KEY` | 선택. 스캔본 등 GLM이 못 읽는 PDF용 |
| `NOTIFY_FROM`, `APP_URL` | 선택. 이메일 알림의 보내는 주소와 메일 속 링크 ([docs/email-setup.md](docs/email-setup.md)) |

터미널 두 개에서 각각 실행합니다.

```bash
cd backend && npm run dev
```

```bash
cd frontend && npm run dev
```

http://localhost:5173 을 엽니다. 백엔드는 5174 포트에서 돌고, 프론트엔드가 `/api`를 서비스 바인딩으로 백엔드에 넘깁니다.

> Workers AI와 Browser Run은 로컬 개발 중에도 실제 Cloudflare에서 실행되어 **소액 과금**됩니다.

## 테스트·평가

```bash
cd backend && npm run check:types && npm test
```

```bash
cd frontend && npm run lint && npm run build
```

- **실제 PDF 스모크 테스트**(모델 호출 있음): `backend/scripts/smoke.sh <pdf>`
- **정답 데이터 만들기**: 같은 열 구성의 CSV(`트림.csv` 등)를 한 폴더에 둔 뒤 `cd backend && npm run golden -- <폴더> fixtures/golden/<차종>.json <차종>`
- **정답 초안을 시트에 올려 화면에서 보기**: `cd backend && npx tsx scripts/golden-to-sheet.ts add fixtures/golden/csv [hex.json] --pdf-dir fixtures/pdf` (지우기: `... remove`). `--pdf-dir`를 주면 PDF를 로컬 R2에 넣어 `원문 PDF` 버튼이 동작합니다. 작업ID `golden_…`, 상태 "확인 필요"로 들어가며 `차량` 탭은 건드리지 않습니다.
- **정확도 평가**: `cd backend && npm run eval -- <jobId>=fixtures/golden/<차종>.json`
  - 결과는 `backend/eval-report.md`에 저장됩니다.
  - 목표: 자동 확정 정확도 99% 이상, 트림·옵션 누락 0, 규칙 재현율 95% 이상.

## 배포

**백엔드는 Cloudflare Workers, 프론트엔드는 Vercel**에 배포합니다. 처음 설정은 [docs/deploy.md](docs/deploy.md)를 따르고, 이후 백엔드는 저장소 루트에서 아래를 실행합니다. 프론트엔드는 `main`에 푸시하면 Vercel이 자동으로 배포합니다.

```bash
./scripts/deploy.sh
```

백엔드 공개 주소는 비밀 키(`API_KEY`)가 있는 요청만 받습니다. 키는 Vercel의 `/api` 프록시 함수만 갖고 있습니다.

## 동작 규칙 요약

- **중복 방지**: 같은 파일이거나, 같은 차종·연식을 이미 정리했으면 다시 처리하지 않습니다. 같은 연식이라도 기준일이 더 새로운 가격표는 자동으로 다시 정리합니다.
- **최신 연식만**: 같은 차종에 더 최신 연식이 있으면 이전 연식은 가져오지 않습니다.
- **연식 판단**: PDF에 "20XX년형"이 있으면 그 값을, 없으면 가격표 기준일의 연도를, 그것도 없으면 처음 받은 날의 연도를 씁니다(실제 3사 가격표에는 연식 표기가 없었음). 같은 파일은 연식과 상관없이 다시 처리하지 않습니다.
- **첫 스캔은 기준선만**: 현재 판매 차량을 기록만 하고 AI 처리는 하지 않습니다. 한 번에 10대를 넘게 처리해야 하면 전부 보류하고 알립니다.
- **검증**: 1·2차 추출이 일치하고, 근거 원문이 해당 페이지에 실제로 있고, 규칙 검사를 통과하면 "자동 확정", 나머지는 "확인 필요"입니다.
- **헥사코드**: 항상 근사값이며, PDF 색상 칩에서 뽑았는지(`PDF 칩`) 표시합니다. 외장 색상만 뽑습니다(내장은 시트 사진이라 부정확).
- **이메일 알림**: 새 데이터가 시트에 추가되면 등록한 주소마다 따로 보냅니다. 무료 플랜에서는 Cloudflare에서 인증한 주소로만 보낼 수 있습니다.
