# Google Sheets 연결 방법

TrimSheet는 정리한 데이터를 **Google Sheets 스프레드시트 1개**에 올립니다.
앱이 시트에 쓰려면 Google Cloud의 **서비스 계정**(사람이 아닌 앱 전용 계정)이 필요합니다.
아래 순서대로 한 번만 설정하면 됩니다. 15분 정도 걸립니다. 모두 무료 범위입니다.

> ⚠️ 서비스 계정 키(JSON 파일)는 비밀번호와 같습니다. 저장소에 커밋하거나 채팅·문서에 붙여 넣지 마세요.
> 이 프로젝트의 `.gitignore`는 `*-sa-key.json`, `*service-account*.json`, `.env`를 제외하지만, 키 파일은 프로젝트 폴더 밖에 두는 것이 가장 안전합니다.

---

## 1. Google Cloud 프로젝트 만들기

1. <https://console.cloud.google.com/> 에 로그인합니다.
2. 상단의 프로젝트 선택 메뉴 → **새 프로젝트**.
3. 이름: `trimsheet` (아무 이름이나 괜찮습니다) → **만들기**.
4. 만든 프로젝트가 선택되어 있는지 상단에서 확인합니다.

## 2. Google Sheets API 사용 설정

1. 왼쪽 메뉴 **API 및 서비스 → 라이브러리**.
2. `Google Sheets API` 검색 → **사용**.

> Google Drive API는 켜지 않아도 됩니다. 앱은 이미 있는 스프레드시트 하나에만 씁니다.

## 3. 서비스 계정 만들기

1. **API 및 서비스 → 사용자 인증 정보** → 상단 **사용자 인증 정보 만들기 → 서비스 계정**.
2. 서비스 계정 이름: `trimsheet-writer` → **만들고 계속하기**.
3. "이 서비스 계정에 프로젝트 액세스 권한 부여"와 "사용자에게 액세스 권한 부여"는 **건너뜁니다**(역할 없음). → **완료**.
4. 목록에 생긴 서비스 계정의 **이메일**을 복사해 둡니다.
   예: `trimsheet-writer@trimsheet-123456.iam.gserviceaccount.com`

## 4. 서비스 계정 키(JSON) 발급

1. 방금 만든 서비스 계정을 클릭 → **키** 탭 → **키 추가 → 새 키 만들기** → **JSON** → **만들기**.
2. JSON 파일이 다운로드됩니다. 프로젝트 폴더 **밖**에 보관하세요.

> 조직 정책 때문에 "서비스 계정 키 생성이 사용 중지됨" 오류가 나오면, 개인 Google 계정으로 만든 프로젝트에서 다시 시도하세요.

## 5. 스프레드시트 만들고 공유하기

1. <https://sheets.google.com/> 에서 **빈 스프레드시트**를 만듭니다. 이름: `TrimSheet 데이터` (자유).
2. 오른쪽 위 **공유** → 3단계에서 복사한 **서비스 계정 이메일**을 입력 → 권한 **편집자** → "이메일 알림 보내기" 체크 해제 → **공유**.
3. 주소창 URL에서 **스프레드시트 ID**를 복사합니다.
   `https://docs.google.com/spreadsheets/d/`**`1AbCdEf...xyz`**`/edit` ← 굵은 부분

> 탭과 헤더는 직접 만들 필요가 없습니다. 앱이 처음 연결될 때 `트림`, `색상`, `선택품목`, `옵션규칙`, `확인필요`, `차량`, `작업`, `PDF목록`, `스캔기록` 탭과 숨김 탭(`_대화`, `_알림`, `_설정`)을 자동으로 만듭니다. 기본으로 있는 `시트1` 탭은 지워도 됩니다.

## 6. 로컬 개발 환경에 값 넣기

### 6-1. `backend/.env` (비밀값)

JSON 키 파일에서 두 값을 꺼내 넣습니다.

```bash
# backend/.env
GOOGLE_SERVICE_ACCOUNT_EMAIL=trimsheet-writer@trimsheet-123456.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...여러 줄...\n-----END PRIVATE KEY-----\n"
```

- `GOOGLE_SERVICE_ACCOUNT_EMAIL` = JSON의 `client_email`
- `GOOGLE_PRIVATE_KEY` = JSON의 `private_key` 값을 **그대로**(줄바꿈이 `\n`으로 적힌 한 줄 문자열) 큰따옴표로 감싸 붙여 넣습니다.

직접 복사하기 번거로우면 아래 명령으로 `.env`에 쓸 두 줄을 출력할 수 있습니다(값이 터미널에 보이니 화면 공유 중에는 실행하지 마세요).

```bash
node -e 'const k=require(process.argv[1]);console.log("GOOGLE_SERVICE_ACCOUNT_EMAIL="+k.client_email);console.log("GOOGLE_PRIVATE_KEY="+JSON.stringify(k.private_key))' /경로/키파일.json
```

### 6-2. `backend/wrangler.jsonc` (비밀값 아님)

```jsonc
"vars": { "GOOGLE_SPREADSHEET_ID": "1AbCdEf...xyz" },
```

### 6-3. 확인

백엔드 dev 서버를 다시 시작한 뒤:

```bash
curl localhost:5174/api/health
```

`"sheets":"ok"`가 나오고 스프레드시트에 탭이 생기면 연결된 것입니다.
`"sheets":"error"`면 백엔드 로그에 원인이 찍힙니다(대부분 공유를 안 했거나 키 붙여 넣기 오류).

## 7. 배포할 때 (Phase 8)

비밀값은 Cloudflare에 따로 등록합니다. 명령을 실행하면 값을 입력하라는 프롬프트가 나옵니다.

```bash
cd backend && npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
```

```bash
cd backend && npx wrangler secret put GOOGLE_PRIVATE_KEY
```

`GOOGLE_PRIVATE_KEY` 프롬프트에는 `-----BEGIN PRIVATE KEY-----`부터 `-----END PRIVATE KEY-----`까지 붙여 넣습니다(`\n` 형태든 실제 줄바꿈이든 앱이 둘 다 처리합니다).

---

## 자주 겪는 문제

| 증상 | 원인 / 해결 |
| --- | --- |
| `403 The caller does not have permission` | 스프레드시트를 서비스 계정 이메일과 **편집자**로 공유하지 않음 |
| `403 Google Sheets API has not been used in project` | 2단계(API 사용 설정)를 안 했거나, 키를 다른 프로젝트에서 발급함 |
| `invalid_grant` / `Invalid JWT Signature` | `GOOGLE_PRIVATE_KEY` 붙여 넣기 오류(따옴표 누락, 일부만 복사). 6-1의 명령으로 다시 출력해서 넣기 |
| `404 Requested entity was not found` | `GOOGLE_SPREADSHEET_ID` 오타 |
| 탭이 생기지 않음 | dev 서버를 재시작하지 않음(`.env`·`wrangler.jsonc`는 시작할 때 읽힘) |

## 비용

Google Sheets API는 무료입니다(분당 요청 수 한도만 있음). TrimSheet는 작업 하나당 탭별로 한 번씩만 쓰도록 만들어져 한도에 걸릴 일이 거의 없습니다.
