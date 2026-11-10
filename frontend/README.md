# trimsheet-frontend

TrimSheet 화면입니다. Google Sheets에 정리된 가격 정보를 **차종별로 보여 주는 화면 하나**와 **새 데이터 이메일 알림** 설정 모달로 이루어져 있습니다. 설계는 [../PLAN.md](../PLAN.md) §8을 참고하세요.

- React 19 · Vite · Tailwind v4 · TanStack Query · 메인 컬러 `#3742fa`
- Cloudflare Worker(`worker/index.ts`)가 정적 파일을 내보내고 `/api/*`를 서비스 바인딩으로 백엔드에 넘깁니다.

## 실행

Node 22(`.nvmrc`)가 필요하고, 백엔드도 함께 띄워야 합니다.

```bash
npm install && npm run dev
```

http://localhost:5173 을 엽니다.

## 구조

| 경로 | 내용 |
| --- | --- |
| `src/App.tsx` | 상단 바(이메일 알림·구글 시트 링크), Sheets 상태 배너 |
| `src/components/catalog/` | 차종 목록(브랜드·검색·페이지 번호), 상세 탭(트림·선택 품목·색상·옵션 규칙) |
| `src/components/notify/` | 이메일 알림 모달 |
| `src/lib/url-state.ts` | 필터·페이지·선택 차종을 주소(`?brand=&q=&page=&v=`)에 저장 |
| `src/lib/api.ts` | `/api/catalog`, `/api/notify` 호출 |

## 확인

```bash
npm run lint && npm run build
```
