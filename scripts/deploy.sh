#!/usr/bin/env bash
# Deploy TrimSheet to Cloudflare (PLAN.md Phase 8.4 / 9). Run from the repository root.
# Order matters: the frontend's service binding needs the backend Worker to exist first.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; nvm use >/dev/null; fi
node -e 'const [maj]=process.versions.node.split(".").map(Number); if (maj < 22) { console.error("Node 22+ required (see .nvmrc)"); process.exit(1) }'

echo "▶ checks"
(cd backend && npx wrangler whoami >/dev/null)
(cd backend && npx wrangler r2 bucket list | grep -q 'trimsheet-files') || {
  echo "R2 bucket 'trimsheet-files' not found. Enable R2 in the dashboard, then: (cd backend && npx wrangler r2 bucket create trimsheet-files)"; exit 1; }
SECRETS=$(cd backend && npx wrangler secret list --name trimsheet-backend 2>/dev/null || echo '[]')
for s in GOOGLE_SPREADSHEET_ID GOOGLE_SERVICE_ACCOUNT_EMAIL GOOGLE_PRIVATE_KEY; do
  echo "$SECRETS" | grep -q "\"$s\"" || echo "⚠️  secret $s is not set — run: (cd backend && npx wrangler secret put $s)"
done
echo "$SECRETS" | grep -q '"OPENAI_API_KEY"' || echo "ℹ️  OPENAI_API_KEY not set — OpenAI fallback disabled (optional)"
echo "$SECRETS" | grep -q '"NOTIFY_FROM"' || echo "ℹ️  NOTIFY_FROM not set — new-data emails are not sent (optional, docs/email-setup.md)"

echo "▶ tests"
(cd backend && npm run check:types && npm test)
(cd frontend && npm run lint && npm run build)

echo "▶ deploy backend"
(cd backend && npm run deploy)
echo "▶ deploy frontend"
(cd frontend && npm run deploy)
echo "✅ done — open the frontend workers.dev URL and check /api/health"
