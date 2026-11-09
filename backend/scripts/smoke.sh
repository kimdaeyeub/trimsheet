#!/usr/bin/env bash
# End-to-end smoke test against the local dev servers (PLAN.md Phase 2.14).
# ⚠️ Calls Workers AI (GLM-4.7-Flash) for real — small but non-zero cost.
# Usage: backend/scripts/smoke.sh path/to/price-sheet.pdf [base-url]
set -euo pipefail
PDF="${1:?usage: smoke.sh <pdf> [base-url]}"
BASE="${2:-http://localhost:5173/api}"

json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(process.argv[1].split(".").reduce((a,k)=>a?.[k],o)??"")})' "$1"; }

echo "▶ health";       curl -sf "$BASE/health"; echo
CONV=$(curl -sf -X POST "$BASE/conversations" -H 'content-type: application/json' -d '{"title":"smoke"}' | json id)
echo "▶ conversation  $CONV"
UP=$(curl -sf -F "file=@$PDF;type=application/pdf" "$BASE/uploads")
echo "▶ upload        $UP"
SRC=$(echo "$UP" | json sourceId)

echo "▶ asking the agent (this calls the model)…"
curl -sf -X POST "$BASE/agents/trimsheet/$CONV" -H 'content-type: application/json' \
  -d "{\"kind\":\"user\",\"body\":\"이 가격표를 정리해 줘 [source:$SRC] [conversation:$CONV]\"}" >/dev/null

for i in $(seq 1 90); do
  sleep 10
  SNAP=$(curl -sf "$BASE/agents/trimsheet/$CONV")
  SETTLED=$(echo "$SNAP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log((o.settlements||[]).length)})')
  [ "$SETTLED" -ge 1 ] && break
  echo "  … waiting ($((i*10))s)"
done

echo "▶ transcript (tool calls and final answer)"
echo "$SNAP" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const o=JSON.parse(s);
  for (const m of o.messages) for (const p of m.parts) {
    if (p.type==="dynamic-tool") console.log(`  [tool] ${p.toolName} ${p.state} ${JSON.stringify(p.output??p.errorText??"").slice(0,300)}`);
    if (p.type==="text" && m.role==="assistant") console.log(`  [assistant] ${p.text}`);
  }
  console.log("  settlements:", JSON.stringify(o.settlements));
})'
echo "▶ jobs";          curl -sf "$BASE/jobs?conversationId=$CONV"; echo
