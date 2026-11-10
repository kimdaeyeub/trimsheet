#!/usr/bin/env bash
# Make a new shared key for the backend ↔ Vercel proxy, without ever printing it.
#   1. sets it as the backend Worker's API_KEY secret (Cloudflare)
#   2. copies it to the clipboard → paste into Vercel: Project → Settings → Environment Variables
#      → BACKEND_API_KEY (Sensitive, Production + Preview), then redeploy the Vercel project.
# Until step 2 is done the deployed site's /api calls fail with 401 (safe: nothing is open).
set -euo pipefail
cd "$(dirname "$0")/../backend"
KEY=$(openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48)
printf '%s' "$KEY" | npx wrangler secret put API_KEY --name trimsheet-backend >/dev/null
if command -v pbcopy >/dev/null; then
  printf '%s' "$KEY" | pbcopy
  echo "✅ 백엔드에 새 API_KEY를 설정했고, 같은 값을 클립보드에 복사했습니다."
  echo "   Vercel → trimsheet 프로젝트 → Settings → Environment Variables → BACKEND_API_KEY 에 붙여 넣고(Sensitive), 다시 배포하세요."
else
  echo "✅ 백엔드에 새 API_KEY를 설정했습니다. (클립보드 도구가 없어 값을 복사하지 못했습니다 — 다시 실행해 값을 받으세요.)"
fi
unset KEY
