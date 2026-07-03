#!/usr/bin/env bash
# End-to-end smoke test for /api/v1/imagesets.
# Requires the dev backend running on http://127.0.0.1:8000 with seeded admin user.
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:8000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@adreview.example.com}"
ADMIN_PASS="${ADMIN_PASS:-change-me-in-production-please-admin}"

pass() { printf "\033[32m✓ %s\033[0m\n" "$1"; }
fail() { printf "\033[31m✗ %s\033[0m\n" "$1"; exit 1; }

# 1. login
TOKEN=$(curl -fsS -X POST "$BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" | jq -r '.access_token')
[ -n "$TOKEN" ] || fail "login"
pass "login"

H="Authorization: Bearer $TOKEN"

# 2. create dataset
SET_ID=$(curl -fsS -X POST "$BASE/api/v1/imagesets" \
  -H "$H" -H 'Content-Type: application/json' \
  -d '{"name":"E2E 库","kind":"黑名单","description":"e2e"}' | jq -r '.id')
[ -n "$SET_ID" ] && [ "$SET_ID" != "null" ] || fail "create imageset"
pass "create imageset id=$SET_ID"

# 3. upload a 1x1 PNG
PNG=/tmp/e2e.png
python3 -c "
import binascii; open('$PNG','wb').write(binascii.unhexlify(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
  '0000000d49444154789c63f8cf0000000300010073e2c80000000049454e44ae426082'))
"

UP_CODE=$(curl -sS -o /tmp/e2e_up.json -w "%{http_code}" -X POST \
  "$BASE/api/v1/imagesets/$SET_ID/items" \
  -H "$H" \
  -F "files=@$PNG;type=image/png")
[ "$UP_CODE" = "201" ] || { cat /tmp/e2e_up.json; fail "upload png (code=$UP_CODE)"; }
ITEM_COUNT=$(jq -r '.item_count' /tmp/e2e_up.json)
UPLOADED=$(jq -r '.uploaded' /tmp/e2e_up.json)
[ "$ITEM_COUNT" = "1" ] && [ "$UPLOADED" = "1" ] || fail "uploaded/item_count"
pass "upload png (item_count=1)"

# 4. list items
ITEMS_CODE=$(curl -sS -o /tmp/e2e_items.json -w "%{http_code}" \
  "$BASE/api/v1/imagesets/$SET_ID/items" -H "$H")
[ "$ITEMS_CODE" = "200" ] || fail "list items (code=$ITEMS_CODE)"
[ "$(jq -r '.total' /tmp/e2e_items.json)" = "1" ] || fail "list items total"
pass "list items"

# 5. bad mime skipped
BAD_CODE=$(curl -sS -o /tmp/e2e_bad.json -w "%{http_code}" -X POST \
  "$BASE/api/v1/imagesets/$SET_ID/items" -H "$H" \
  -F "files=@$PNG;type=text/plain;filename=bad.txt")
[ "$BAD_CODE" = "201" ] || fail "bad mime (code=$BAD_CODE)"
[ "$(jq -r '.skipped' /tmp/e2e_bad.json)" = "1" ] || fail "skipped count"
pass "bad mime skipped"

# 6. over 100 limit
TMPDIR=$(mktemp -d)
for i in $(seq 1 101); do cp "$PNG" "$TMPDIR/f$i.png"; done
# build 101 -F args
ARGS=()
for i in $(seq 1 101); do ARGS+=( -F "files=@$TMPDIR/f$i.png" ); done
OVER_CODE=$(curl -sS -o /tmp/e2e_over.json -w "%{http_code}" -X POST \
  "$BASE/api/v1/imagesets/$SET_ID/items" -H "$H" "${ARGS[@]}")
[ "$OVER_CODE" = "400" ] || { cat /tmp/e2e_over.json; fail "over-limit (code=$OVER_CODE)"; }
rm -rf "$TMPDIR"
pass "over-limit rejected"

# 7. list with kind filter
LIST_CODE=$(curl -sS -o /tmp/e2e_list.json -w "%{http_code}" -G \
  --data-urlencode "kind=黑名单" \
  "$BASE/api/v1/imagesets" -H "$H")
[ "$LIST_CODE" = "200" ] || { cat /tmp/e2e_list.json; fail "list filter (code=$LIST_CODE)"; }
[ "$(jq -r '.total' /tmp/e2e_list.json)" -ge 1 ] || fail "list filter count"
pass "list filter"

# 8. delete
DEL_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -X DELETE \
  "$BASE/api/v1/imagesets/$SET_ID" -H "$H")
[ "$DEL_CODE" = "204" ] || fail "delete (code=$DEL_CODE)"
pass "delete imageset"

# 9. verify 404
GET_CODE=$(curl -sS -o /dev/null -w "%{http_code}" \
  "$BASE/api/v1/imagesets/$SET_ID" -H "$H")
[ "$GET_CODE" = "404" ] || fail "get after delete (code=$GET_CODE)"
pass "404 after delete"

echo
echo "All E2E checks passed."
