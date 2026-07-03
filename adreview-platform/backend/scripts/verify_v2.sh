#!/usr/bin/env bash
# Verify v2 wordset schema accepts group + action
set -euo pipefail
BASE="${BASE:-http://127.0.0.1:8000}"

pass() { printf "\033[32m✓ %s\033[0m\n" "$1"; }
fail() { printf "\033[31m✗ %s\033[0m\n" "$1"; exit 1; }

TOKEN=$(curl -fsS -X POST "$BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@adreview.example.com","password":"change-me-in-production-please-admin"}' | jq -r '.access_token')
H="Authorization: Bearer $TOKEN"

# 1. create with group=敏感词 + action=黑名单
R=$(curl -fsS -X POST "$BASE/api/v1/wordsets" \
  -H "$H" -H 'Content-Type: application/json' \
  -d '{"name":"v2测试1","group":"敏感词","action":"黑名单","words":["违禁"]}')
ID=$(echo "$R" | jq -r '.id')
G=$(echo "$R" | jq -r '.group')
A=$(echo "$R" | jq -r '.action')
[ "$G" = "敏感词" ] && [ "$A" = "黑名单" ] || fail "create group/action"
pass "create wordset with group=敏感词 action=黑名单 id=$ID"

# 2. create with group=广告法 + action=需复审
R=$(curl -fsS -X POST "$BASE/api/v1/wordsets" \
  -H "$H" -H 'Content-Type: application/json' \
  -d '{"name":"v2测试2","group":"广告法","action":"需复审","words":["最好"]}')
G=$(echo "$R" | jq -r '.group')
A=$(echo "$R" | jq -r '.action')
[ "$G" = "广告法" ] && [ "$A" = "需复审" ] || fail "create review"
pass "create group=广告法 action=需复审"

# 3. filter by group
LIST_CODE=$(curl -sS -o /tmp/v2_list.json -w "%{http_code}" -G \
  --data-urlencode "group=广告法" \
  "$BASE/api/v1/wordsets" -H "$H")
[ "$LIST_CODE" = "200" ] || fail "list by group"
T=$(jq -r '.total' /tmp/v2_list.json)
[ "$T" -ge 1 ] || fail "list by group empty"
pass "list filter group=广告法 (total=$T)"

# 4. filter by action
LIST_CODE=$(curl -sS -o /tmp/v2_list.json -w "%{http_code}" -G \
  --data-urlencode "action=需复审" \
  "$BASE/api/v1/wordsets" -H "$H")
[ "$LIST_CODE" = "200" ] || fail "list by action"
T=$(jq -r '.total' /tmp/v2_list.json)
[ "$T" -ge 1 ] || fail "list by action empty"
pass "list filter action=需复审 (total=$T)"

# 5. update group + action
PUT_CODE=$(curl -sS -o /tmp/v2_put.json -w "%{http_code}" -X PUT \
  "$BASE/api/v1/wordsets/$ID" \
  -H "$H" -H 'Content-Type: application/json' \
  -d '{"group":"品牌","action":"白名单"}')
[ "$PUT_CODE" = "200" ] || fail "update"
G=$(jq -r '.group' /tmp/v2_put.json)
A=$(jq -r '.action' /tmp/v2_put.json)
[ "$G" = "品牌" ] && [ "$A" = "白名单" ] || fail "update group/action"
pass "update group+action"

# 6. image set v2
R=$(curl -fsS -X POST "$BASE/api/v1/imagesets" \
  -H "$H" -H 'Content-Type: application/json' \
  -d '{"name":"v2图片测试","group":"品牌","action":"需复审"}')
G=$(echo "$R" | jq -r '.group')
A=$(echo "$R" | jq -r '.action')
[ "$G" = "品牌" ] && [ "$A" = "需复审" ] || fail "image create"
pass "create imageset group=品牌 action=需复审"

echo
echo "All v2 checks passed."
