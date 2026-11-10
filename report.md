# TrimSheet 진행 보고서

> 작성일: 2026-11-10 · 최종 갱신: Phase 8 완료 후
> 상세 설계와 결정 기록은 [PLAN.md](PLAN.md), 사이트 조사 결과는 [docs/site-notes.md](docs/site-notes.md), Google Sheets 연결 방법은 [docs/google-sheets-setup.md](docs/google-sheets-setup.md)에 있습니다.

## 1. 한 줄 요약

Phase 0~8의 **코드·도구·문서는 모두 작성·테스트되었고 GitHub에 올라가 있습니다**. 실제 데이터(가격표 PDF, Google Sheets)와 유료 서비스(Workers AI, Browser Run)를 쓰는 확인과 실제 배포는 **Phase 9**로 모았습니다. [PLAN.md](PLAN.md)의 Phase 9.0 준비물이 채워지면 바로 시작합니다.

- 백엔드 테스트 **156개** 통과 · 타입 체크 · 프로덕션 빌드 통과
- 프론트엔드 타입 체크 · 빌드 · lint 경고 없음
- 개발 중 Workers AI 호출은 Phase 0 연결 확인 1회뿐입니다(대화 1건). Browser Run·OpenAI는 한 번도 호출하지 않았습니다.

## 2. 단계별 상태

| Phase | 내용 | 코드 | 실제 데이터 확인 |
| --- | --- | --- | --- |
| 0 | 기반 정리(Worker 설정, 서비스 바인딩 프록시, 공용 타입) | ✅ | ✅ 로컬 연결·GLM 응답 확인 / ⏳ R2 버킷 미생성 |
| 1 | Google Sheets·R2 저장소, REST API | ✅ | ✅ 로컬 업로드 확인 / ⏳ 실제 시트 연결 |
| 2 | PDF→시트 추출 파이프라인, 중복 판정, Flue 도구·에이전트 | ✅ | ⏳ 실제 가격표로 실행 |
| 3 | 프론트엔드(대화, 업로드, 도구 카드, 작업 목록) | ✅ | ✅ 화면·모바일 / ⏳ 실제 대화 흐름 |
| 4 | 1·2차 교차검증, 검토(승인·수정·제외) | ✅ | ⏳ 실제 데이터로 검토 화면 |
| 5 | 차종 페이지 URL에서 PDF 찾기 | ✅ | ✅ 사이트 구조 조사 / ⏳ Browser Run 실제 실행 |
| 6 | 3사 주간 스캔, 기준선, 신규 감지, 수집 현황 화면 | ✅ | ⏳ 실제 스캔, cron 트리거 |
| 7 | 헥사코드 근사값(PDF 색상 칩) | ✅ | ⏳ 실제 PDF의 칩 형태 |
| 8 | 평가 도구(정답 변환·정확도 측정), 배포 준비(스크립트·안내서·공개 URL 차단), README | ✅ | — (실행은 Phase 9) |
| 9 | 실제 데이터 확인, 정확도 평가 실행, 배포·접근 보호 | — | ⏳ 준비물(9.0) 대기 |

## 3. 지금까지 한 작업

### 백엔드 (`backend/`, Cloudflare Worker `trimsheet-backend`)

- **에이전트(Flue)**
  - `TrimSheet`: 대화용 에이전트. 모델은 `cloudflare/@cf/zai-org/glm-4.7-flash`입니다.
  - `Watcher`: 주간 수집 담당. 도구를 한 번만 불러 GLM 호출을 최소화합니다.
- **도구**: `find_pdfs_on_page`, `register_pdf_url`, `prepare_source`, `extract_pass`(1차·2차), `finalize_job`, `get_job`, `search_vehicles`, `scan_brands`
  - 모든 단계 도구는 다음에 부를 도구(`nextStep`)를 돌려주고, 순서가 틀리면 코드가 막습니다.
- **추출 파이프라인**
  - PDF의 글자 위치로 표를 텍스트로 되살린 뒤 GLM에 넣습니다(GLM은 PDF를 직접 읽지 못함).
  - 문서 정보·트림·색상 / 선택 품목 / 옵션 규칙의 3부분으로 나눠 추출합니다.
  - 1차와 2차는 서로 다른 방식으로 읽어 교차검증합니다.
  - 검증 항목: 가격 형식, 존재하지 않는 옵션·트림 참조, 규칙 모순, 근거 원문이 해당 페이지에 실제로 있는지.
- **OpenAI 폴백**: 스캔본, 텍스트가 너무 긴 경우, GLM 2회 실패, 품질 미달일 때만 OpenAI로 PDF를 직접 보냅니다. 키가 없으면 폴백하지 않습니다.
- **중복 방지와 최신 연식**
  - 다운로드 전에 URL과 ETag로, 다운로드 후 AI 호출 전에 파일 해시로, 마지막으로 브랜드·차종·연식으로 같은 차량인지 판정합니다.
  - 판정 규칙은 R1~R11입니다. 같은 연식이라도 기준일이 더 새로운 가격표는 자동으로 다시 정리하고, 첫 스캔은 기준선 등록만 하며, 한 스캔에서 10대를 넘으면 전부 보류합니다.
- **저장소**
  - 정리한 데이터: Google Sheets(탭 12개, 시트가 기준 데이터)
  - PDF·작업 상태·잠금: R2
  - DB는 쓰지 않습니다.
- **수집기**
  - 현대: 라인업 페이지를 렌더링하고, 가격표 주소는 차종 slug로 계산합니다.
  - 기아: 카탈로그/가격표 페이지에서 탭 5개를 렌더링합니다.
  - 제네시스: 일반 HTML로 목록을 읽고 POST로 PDF를 받습니다. 같은 차종의 예전 파일은 버립니다.
  - 상용차는 제외합니다.
- **헥사코드**: PDF 그리기 명령에서 사각형 칩과 이미지 칩을 위치와 함께 찾아, 가장 가까운 색상명과 짝짓습니다. 출처(`PDF 칩` / `OpenAI 추정` / `사용자 수정`)를 함께 기록합니다.
- **REST API**: health, settings, conversations, uploads, files, jobs(조회·검토), vehicles, scan-runs, notifications
- **cron**: 매주 월요일 09:00(KST)

### 프론트엔드 (`frontend/`, Cloudflare Worker `trimsheet-frontend`)

- `/api/*` 요청은 서비스 바인딩으로 백엔드에 넘깁니다.
- 메인 컬러 `#3742fa`, Tailwind v4, Pretendard 글꼴
- 화면: 홈, 대화(도구 카드·PDF 후보 카드), 작업 결과, 검토(승인·수정·제외, PDF 뷰어), 수집 현황(필터·여러 대 정리)
- 알림 종, Google Sheets 미연결 배너, 모바일 드로어

### 커밋 이력

| 커밋 | 내용 |
| --- | --- |
| `012dfa0` | 계획서, Phase 0~2 백엔드 |
| `68a5472` | Phase 3 프론트엔드 |
| `44b1261` | Phase 4 교차검증·검토 |
| `8e943ee` | Phase 5 PDF 찾기 |
| `677c1ac` | Phase 6 주간 스캔·수집 현황 |
| `b8b1d92` | Phase 7 헥사코드 |
| `28cd686` | 진행 보고서 |
| (이번 커밋) | Phase 8 평가·배포 준비, Phase 9 정의 |

## 4. 수정이 필요하거나 주의해야 할 사항

현재 **알려진 실패 테스트나 빌드 오류는 없습니다**. 아래는 실제 실행 전까지 확인되지 않은 위험과, 우회 처리해 둔 문제입니다.

### 4-1. 우회해 둔 문제 (나중에 정리 필요)

| # | 문제 | 현재 조치 | 해야 할 일 |
| --- | --- | --- | --- |
| A | `@earendil-works/pi-ai`·`pi-agent-core` 1.5.0이 Flue 2.3.0과 맞지 않아 빌드가 깨짐 | `backend/package.json` `overrides`로 1.4.0 고정 | Flue가 1.5를 지원하면 고정 해제 |
| B | 설치된 workerd가 `compatibility_date` 2026-11-09를 거부 | 2026-11-08로 설정 | Wrangler/workerd 업데이트 후 날짜 갱신 |
| C | 기본 Node v21에서는 Wrangler가 실행되지 않음 | `.nvmrc`(22.23.2), `.claude/launch.json`에 지정 | 직접 실행할 때 `nvm use` 필수 |
| D | 백엔드 번들이 gzip 기준 **약 2.73MB**로 Workers 무료 플랜 한도(3MB)에 근접 | 없음 | 의존성이 더 늘면 유료 플랜 전환 또는 `pdf-lib` 등 정리 |
| E | 기아 내부 JSON API 직접 호출은 권한 검사에서 거부됨 | 공개 페이지 렌더링만 사용 | 없음(설계상 그대로 둠) |

### 4-2. 실제 실행 전까지 확인되지 않은 위험

| # | 확인할 것 | 문제가 있을 때 대안 |
| --- | --- | --- |
| 1 | GLM-4.7-Flash가 Flue `result`(구조화 출력)를 안정적으로 내는지, 실제 가격표에서 정확한지 (PLAN 2.0) | 섹션을 더 잘게 나누기, Workers AI JSON 모드로 직접 호출, 2차 추출만 OpenAI로 고정 |
| 2 | GLM이 도구를 순서대로 부르는지 (PLAN 2.12) | 도구 하나(`process_pdf`)로 합치는 단일 도구 모드 |
| 3 | 도구 안에서 `import { env } from 'cloudflare:workers'`가 동작하는지 (`backend/src/shared/env.ts` TODO) | `getCloudflareContext().env`로 교체 |
| 4 | OpenAI 폴백 모델 ID `openai/gpt-5.5`가 맞는지 (`backend/src/shared/config.ts` TODO) | 사용 가능한 최신 ID로 교체 |
| 5 | PDF 분석의 Worker CPU 시간이 무료 플랜 한도 안인지 (PLAN 2.15) | `limits.cpu_ms` 상향(유료 플랜) |
| 6 | Browser Run에서 현대 라인업·기아 탭 클릭이 실제로 동작하는지 | `docs/site-notes.md` 기준으로 선택자 수정 |
| 7 | 제네시스 POST 다운로드가 쿠키·Referer 없이 되는지 | 브라우저 세션으로 받기 |
| 8 | 현대 가격표 주소 계산 규칙이 모든 차종에 맞는지 (일부 차종은 404일 수 있음) | 404 차종은 스캔 실패 목록에 남음 → 차종 페이지 "가격표" 버튼 클릭 방식으로 보완 |
| 9 | 세 사이트 모두 URL에 연식이 없어 **연식은 PDF 표지 텍스트로만 판단**함. 표지에 "2027년형" 같은 표기가 없으면 그 차량은 **보류** | 첫 스캔에서 보류가 많으면 연식 판단 규칙 보강(본문 검색 범위 확대 등) |
| 10 | 실제 제조사 PDF의 색상 칩이 사각형인지 이미지인지, 색상명과의 거리 (PLAN 7.1) | 짝짓기 거리 기준 조정 |
| 11 | 도구 안(Durable Object)에서 `dispatch`로 새 대화를 시작하는 것 (Flue 소스로는 가능 확인) | Cloudflare Queues로 넘기기 |
| 12 | 로컬에서 cron(scheduled) 핸들러를 트리거하는 방법 (PLAN 6.10) | 수동 "지금 확인" API로 대체 검증 |

### 4-3. 알고 있는 동작상 제약

- **Google Sheets 미연결 상태**: 데이터가 메모리에만 저장되어 백엔드 dev 서버를 다시 시작하면 사라집니다. 화면 상단 노란 배너로 안내합니다.
- **Workers AI 과금**: Workers AI 바인딩은 로컬 개발 중에도 실제 Cloudflare로 호출되어 소액 과금됩니다.
- **`project-overview.md` 공개 여부**: 클라이언트 문의 내용이 담긴 기획서가 공개 저장소에 올라가 있습니다. 공개해도 괜찮은지 확인해 주세요.

## 5. 사용자가 채워 줘야 하는 부분 (= PLAN.md Phase 9.0)

| 우선순위 | 항목 | 방법 | 필요한 단계 |
| --- | --- | --- | --- |
| 1 | **실제 가격표 PDF** (예: 더 뉴 스타리아 Electric) 1개 이상 | `backend/fixtures/pdf/`에 넣기. 같은 차종의 이전 연식 PDF가 있으면 함께 | Phase 2·3·4·7 실제 확인 |
| 2 | **Google Sheets 연결** | [docs/google-sheets-setup.md](docs/google-sheets-setup.md) 순서대로 → `backend/.env`에 `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` / `backend/wrangler.jsonc`의 `vars.GOOGLE_SPREADSHEET_ID` | 1.8 및 결과 저장 전체 |
| 3 | **OpenAI API 키** (선택) | `backend/.env`의 `OPENAI_API_KEY`. 없으면 스캔본 PDF는 처리하지 않고, GLM 품질이 낮아도 폴백하지 않음 | 폴백 |
| 4 | **R2 활성화** | Cloudflare 대시보드 → R2 메뉴에서 활성화(결제 수단 등록이 필요할 수 있음). 활성화 후 알려 주시면 버킷 `trimsheet-files` 생성 | 0.5, 배포 |
| 5 | **정답 데이터 3종** | 사람이 직접 정리한 차종 3개의 결과. Google Sheets의 `트림`·`색상`·`선택품목`·`옵션규칙` 탭과 같은 열 구성으로 만들어 CSV로 내려받기(`차종` 열로 구분) → `npm run golden`으로 변환 | 9.10 정확도 평가 |
| 6 | **결정 필요** | 아래 표 참고 | 9.10, 9.11 |

**결정이 필요한 것**

| 항목 | 선택지 | 현재 기본값 |
| --- | --- | --- |
| 2차 추출을 OpenAI로 고정할지 | GLM 유지 / OpenAI 고정(정확도↑, 비용↑) | GLM 유지 — Phase 8 평가 후 결정 |
| 배포 후 접근 보호 | Cloudflare Access(본인 이메일만) / 공개 URL 그대로 | 미정 — 공개 시 누구나 AI 비용을 발생시킬 수 있어 Access 권장 |
| 유료 플랜 전환 | CPU 시간·번들 크기 한도를 넘을 때 | 실제 측정 후 판단 |

## 6. 다음 순서 (Phase 9)

PLAN.md의 Phase 9에 단계별 통과 기준을 적어 두었습니다. 요약하면 다음과 같습니다.

1. **9.1** Google Sheets 연결 확인
2. **9.2~9.7** 실제 PDF로 확인: 전체 흐름, 도구 순서, 중복·연식 시나리오, CPU 시간, 검토 화면, 헥사코드. 비용은 PDF 1개당 GLM 호출 약 10회 이내입니다.
3. **9.8~9.9** 제조사 사이트에서 PDF 찾기, 첫 스캔(기준선 등록, AI 처리 없음)과 cron. Browser Run 사용 시간이 듭니다.
4. **9.10** 정답 데이터 3종으로 정확도 평가(`npm run eval`)
5. **9.11** R2 버킷 생성 → 비밀값 등록 → `./scripts/deploy.sh` → (결정 시) Cloudflare Access 적용
6. **9.12** report.md 갱신과 마무리
