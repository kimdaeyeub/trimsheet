# 배포 안내 (PLAN.md Phase 8.4 · 8.5)

TrimSheet는 Worker 두 개로 배포합니다.

| Worker | 역할 | 공개 URL |
| --- | --- | --- |
| `trimsheet-backend` | API, Flue 에이전트(Durable Object), cron | **없음** (`workers_dev: false`) — 프론트엔드가 서비스 바인딩으로만 호출 |
| `trimsheet-frontend` | 화면 + `/api/*` 프록시 | `https://trimsheet-frontend.<계정>.workers.dev` |

## 1. 배포 전에 한 번만

1. **Node 22** — 저장소 루트에서 `nvm use` (`.nvmrc` = 22.23.2)
2. **로그인** — `cd backend && npx wrangler login`
3. **R2 활성화** — Cloudflare 대시보드 → R2 → 활성화(결제 수단 등록이 필요할 수 있음) → 버킷 생성:

```bash
cd backend && npx wrangler r2 bucket create trimsheet-files
```

4. **비밀값 등록** — 명령마다 값을 붙여 넣는 프롬프트가 나옵니다.

```bash
cd backend && npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
```

```bash
cd backend && npx wrangler secret put GOOGLE_PRIVATE_KEY
```

```bash
cd backend && npx wrangler secret put GOOGLE_SPREADSHEET_ID
```

```bash
cd backend && npx wrangler secret put OPENAI_API_KEY
```

(`OPENAI_API_KEY`는 선택 — 없으면 스캔본 PDF는 처리하지 않고 GLM 결과를 그대로 씁니다.)

5. **스프레드시트 ID** — 위 `GOOGLE_SPREADSHEET_ID` 비밀값으로 등록합니다(저장소가 공개라 설정 파일에 넣지 않음).

## 2. 배포

저장소 루트에서:

```bash
./scripts/deploy.sh
```

스크립트가 하는 일: Node 버전·로그인·R2 버킷·비밀값 확인 → 타입 체크·테스트·빌드 → **백엔드 먼저** 배포(서비스 바인딩 대상이 있어야 하므로) → 프론트엔드 배포.

## 3. 배포 후 확인

- `https://trimsheet-frontend.<계정>.workers.dev/api/health` → `{"ok":true,"sheets":"ok",...}`
- Cloudflare 대시보드 → Workers → `trimsheet-backend` → Logs / Traces에 오류가 없는지
- Triggers 탭에 cron `0 0 * * 1`(월 09:00 KST)이 있는지
- **첫 cron 전에** 스프레드시트의 숨김 탭 `_설정`에서 `baseline_done`이 `FALSE`인지(첫 스캔은 기준선 등록만)

## 4. 접근 보호 (권장 — 결정 필요)

인증이 없는 앱이라, 프론트엔드 URL을 아는 사람은 누구나 AI 작업을 실행해 비용을 발생시킬 수 있습니다. **Cloudflare Access로 본인 이메일만 허용**하는 것을 권장합니다(무료 플랜 50명까지).

1. 대시보드 → Workers & Pages → `trimsheet-frontend` → Settings → Domains & Routes
2. `workers.dev` 항목의 **Cloudflare Access** 켜기 → 생성된 Access 애플리케이션의 정책에서 허용 이메일을 본인 이메일로 지정
3. 시크릿 창에서 접속해 이메일 인증 화면이 나오는지 확인

백엔드는 공개 URL이 없으므로 따로 보호할 필요가 없습니다.

## 5. 되돌리기

- 코드: 대시보드 → Worker → Deployments에서 이전 버전으로 롤백(데이터는 되돌아가지 않음)
- 데이터: Google Sheets의 버전 기록, R2의 PDF는 내용 해시로 저장되어 덮어쓰지 않음
