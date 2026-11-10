# trimsheet-backend

TrimSheet 백엔드 Worker입니다. Hono REST API, [Flue](https://flueframework.com) 에이전트(`TrimSheet`: PDF 정리, `Watcher`: 주간 스캔), 주간 cron, Google Sheets 저장, 새 데이터 이메일 알림을 맡습니다. 전체 설명은 [../README.md](../README.md), 설계는 [../PLAN.md](../PLAN.md)를 참고하세요.

## 실행

Node 22(`.nvmrc`)가 필요합니다. `.env.example`을 복사해 `.env`를 채운 뒤 실행합니다.

```bash
npm install && npm run dev
```

서버는 5174 포트에서 뜹니다. 보통은 프론트엔드(5173)가 `/api`를 이쪽으로 넘깁니다. 라우트 목록과 에이전트 호출 예시는 `src/app.ts`에 있습니다.

## 확인

```bash
npm run check:types && npm test
```

## 스크립트

| 명령 | 내용 |
| --- | --- |
| `npm run golden -- <csv-dir> <out.json> [차종]` | 정답 CSV → 평가용 JSON |
| `npm run eval -- <jobId>=<golden.json>` | 정확도 평가 → `eval-report.md` |
| `npx tsx scripts/golden-to-sheet.ts add <csv-dir> [hex.json]` | 정답 초안을 시트에 올려 화면에서 보기 (`remove`로 삭제) |
| `scripts/smoke.sh <pdf>` | 실제 PDF 스모크 테스트(모델 호출 있음) |
| `npm run cf-typegen` | `wrangler.jsonc`·`.env`를 바꾼 뒤 `Env` 타입 다시 만들기 |
