# 배포 안내

TrimSheet는 두 곳에 나눠 배포합니다.

| 부분 | 어디에 | 주소 | 하는 일 |
| --- | --- | --- | --- |
| 백엔드 `trimsheet-backend` | Cloudflare Workers | `https://trimsheet-backend.<계정>.workers.dev` | API, Flue 에이전트(Durable Object), 주간 cron, R2·Workers AI·Browser Run·Email |
| 프론트엔드 `trimsheet` | Vercel | `https://<프로젝트>.vercel.app` | 화면(정적 파일) + `/api/*` 프록시 함수(`frontend/api/proxy.ts`) |

```
브라우저 ─▶ Vercel (화면, /api 프록시 함수) ──x-trimsheet-key──▶ Cloudflare 백엔드
```

백엔드 주소는 공개되어 있지만, **`x-trimsheet-key` 헤더에 비밀 키(`API_KEY`)가 없으면 모든 `/api` 요청을 401로 거절**합니다. 키는 Cloudflare 비밀값과 Vercel 환경 변수에만 있고 브라우저에는 가지 않습니다.

## 1. 처음 한 번만

1. **Node 22** — 저장소 루트에서 `nvm use` (`.nvmrc` = 22.23.2)
2. **Cloudflare 로그인** — `cd backend && npx wrangler login`
3. **R2** — 대시보드에서 R2를 활성화하고 버킷을 만듭니다.

```bash
cd backend && npx wrangler r2 bucket create trimsheet-files
```

4. **백엔드 비밀값** — 명령마다 값을 붙여 넣는 프롬프트가 나옵니다(공개 저장소라 설정 파일에 넣지 않음).

```bash
cd backend && npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
```

```bash
cd backend && npx wrangler secret put GOOGLE_PRIVATE_KEY
```

```bash
cd backend && npx wrangler secret put GOOGLE_SPREADSHEET_ID
```

   - 선택: `OPENAI_API_KEY`(없으면 스캔본 PDF는 처리하지 않음), `NOTIFY_FROM`·`APP_URL`(이메일 알림, [email-setup.md](email-setup.md)).

5. **공유 키** — 아래 스크립트가 새 키를 만들어 백엔드 `API_KEY`에 넣고 **클립보드에 복사**합니다(화면에 출력하지 않음).

```bash
./scripts/rotate-api-key.sh
```

6. **Vercel 프로젝트** — vercel.com/new에서 GitHub 저장소를 Import하고:
   - Root Directory: `frontend` (빌드 설정은 `frontend/vercel.json`에 있음)
   - Environment Variables:
     - `BACKEND_URL` = 백엔드 주소(`https://trimsheet-backend.<계정>.workers.dev`)
     - `BACKEND_API_KEY` = 5번에서 복사한 값 (Sensitive, Production·Preview)

## 2. 배포

- **백엔드:** 저장소 루트에서 실행합니다. 검사·테스트·빌드 뒤 Cloudflare에 배포합니다.

```bash
./scripts/deploy.sh
```

- **프론트엔드:** `main`에 푸시하면 Vercel이 자동으로 다시 배포합니다.

## 3. 배포 후 확인

- Vercel 주소를 열어 차종 목록이 보이는지
- 키 없이 백엔드를 부르면 401인지: `curl -i https://trimsheet-backend.<계정>.workers.dev/api/health`
- Cloudflare 대시보드 → Workers → `trimsheet-backend` → Logs에 오류가 없는지, Triggers에 cron `0 0 * * 1`(월 09:00 KST)이 있는지
- 첫 cron 전에 시트의 숨김 탭 `_설정`에서 `baseline_done`이 `FALSE`인지(첫 스캔은 기준선 등록만)

## 4. 접근 보호

Vercel 프로젝트는 기본으로 **Vercel Authentication**이 켜져 있어(사용자 지정 도메인을 제외한 모든 배포), Vercel에 로그인한 본인만 열 수 있습니다. 다른 사람에게 보여 주려면 Vercel → Settings → Deployment Protection에서 바꾸세요. 공개하면 누구나 화면의 API를 부를 수 있습니다.

## 5. 키를 바꾸고 싶을 때

`./scripts/rotate-api-key.sh`를 다시 실행한 뒤 Vercel의 `BACKEND_API_KEY`를 새 값으로 바꾸고 다시 배포합니다. 그 사이에는 화면의 API 호출이 401로 실패합니다.

## 6. 되돌리기

- 백엔드: Cloudflare 대시보드 → Worker → Deployments에서 이전 버전으로 롤백
- 프론트엔드: Vercel → Deployments에서 이전 배포를 Promote
- 데이터: Google Sheets 버전 기록. R2의 PDF는 내용 해시로 저장되어 덮어쓰지 않음

## 로컬 개발

로컬은 그대로입니다. 프론트엔드 Worker가 서비스 바인딩으로 백엔드를 부르고, `backend/.env`의 `API_KEY`를 비워 두면 키 검사도 하지 않습니다.
