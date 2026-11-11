#!/usr/bin/env bash
# Runs the worker locally on a throwaway database and checks every endpoint. `npm test` in funding/.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=8799 BASE=http://127.0.0.1:8799 STATE=$(mktemp -d)
trap 'kill $DEV 2>/dev/null; rm -rf "$STATE"' EXIT
VARS="--var KOFI_TOKEN:kofi-test --var PATREON_SECRET:patreon-test --var ADMIN_TOKEN:admin-test"

npx wrangler d1 execute sirius-funding --local --persist-to "$STATE" --file schema.sql >/dev/null
npx wrangler dev --port $PORT --persist-to "$STATE" $VARS >"$STATE/dev.log" 2>&1 & DEV=$!
for _ in $(seq 60); do curl -sf $BASE/funding >/dev/null && break; sleep 0.5; done

fail=0
check() {  # name, expected substring, actual
  if [[ "$3" == *"$2"* ]]; then echo "ok   $1"; else echo "FAIL $1: wanted $2, got $3"; fail=1; fi
}
admin() { curl -s -H 'Authorization: Bearer admin-test' -H 'Content-Type: application/json' "$@"; }
kofi() { curl -s $BASE/kofi --data-urlencode "data=$1"; }
patreon() {  # body
  local sig; sig=$(printf '%s' "$1" | openssl dgst -md5 -hmac patreon-test -r | cut -d' ' -f1)
  curl -s $BASE/patreon -H "X-Patreon-Signature: $sig" -H 'X-Patreon-Event: members:update' --data-binary "$1"
}

check "admin needs the token" unauthorized "$(curl -s $BASE/admin)"
check "goal without a date is refused" "start date" "$(admin -X PUT $BASE/admin/goals -d '{"goals":[{"label":"X","target":5,"currency":"EUR"}]}')"
check "goals saved" "NPC faces" "$(admin -X PUT $BASE/admin/goals -d '{"goals":[
  {"label":"Servers this month","target":200,"currency":"EUR","monthly":true},
  {"label":"NPC faces and clothes","target":100,"currency":"EUR","since":"2026-01-01"}]}')"

check "ko-fi without data" "no data" "$(curl -s -X POST $BASE/kofi)"
check "ko-fi wrong token" unauthorized "$(kofi '{"verification_token":"nope","message_id":"a","type":"Donation","amount":"5.00","currency":"EUR","from_name":"X","is_public":true}')"
check "ko-fi donation" '"ok":true' "$(kofi '{"verification_token":"kofi-test","message_id":"m1","type":"Donation","amount":"5.00","currency":"EUR","from_name":"  Star\u0007Pilot  ","is_public":true}')"
kofi '{"verification_token":"kofi-test","message_id":"m1","type":"Donation","amount":"5.00","currency":"EUR","from_name":"StarPilot","is_public":true}' >/dev/null  # resend
kofi '{"verification_token":"kofi-test","message_id":"m2","type":"Donation","amount":"3.50","currency":"EUR","from_name":"Secret Person","is_public":false}' >/dev/null
check "ko-fi shop order ignored" ignored "$(kofi '{"verification_token":"kofi-test","message_id":"m3","type":"Shop Order","amount":"30.00","currency":"EUR","from_name":"Buyer","is_public":true}')"

M='{"data":{"id":"mem1","type":"member","attributes":{"full_name":"Jane Doe","campaign_lifetime_support_cents":500,"last_charge_date":"2026-11-01T10:00:00Z","last_charge_status":"Paid"}}}'
check "patreon bad signature" unauthorized "$(curl -s $BASE/patreon -H 'X-Patreon-Signature: 00' --data-binary "$M")"
check "patreon first charge" '"ok":true' "$(patreon "$M")"
patreon "$M" >/dev/null                                   # same webhook again: no new payment
patreon "${M/500/1000}" >/dev/null                         # next month: +5

check "manual tip" '"ok":true' "$(admin $BASE/admin/donations -d '{"name":"StreamFan","amount":2,"currency":"EUR"}')"

F=$(curl -s $BASE/funding)
echo "$F"
# 5 + 3.50 + 5 + 5 + 2 = 20.5 this month and since January
check "monthly raised" '"label":"Servers this month","target":200,"raised":20.5' "$F"
check "since-date raised" '"label":"NPC faces and clothes","target":100,"raised":20.5' "$F"
check "control char stripped" '"name":"StarPilot"' "$F"
check "private is Anonymous" '"name":"Anonymous"' "$F"
check "patreon first name only, once" '"name":"Jane"' "$F"
[[ "$F" != *Doe* && "$F" != *Secret* && "$F" != *Buyer* ]] && echo "ok   no surnames, private names or buyers" || { echo "FAIL leaked a name"; fail=1; }
[[ $(grep -o '"name":"Jane"' <<<"$F" | wc -l) == 1 ]] && echo "ok   a backer listed once" || { echo "FAIL Jane twice"; fail=1; }

check "hide a name" '"ok":true' "$(admin $BASE/admin/donations/kofi:m1 -d '{"hidden":true}')"
check "void a payment" '"ok":true' "$(admin $BASE/admin/donations/kofi:m2 -d '{"void":true}')"
F=$(curl -s $BASE/funding)
check "void not counted" '"raised":17' "$F"
[[ "$F" != *StarPilot* ]] && echo "ok   hidden name gone" || { echo "FAIL hidden name shown"; fail=1; }

exit $fail
