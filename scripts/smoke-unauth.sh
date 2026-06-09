#!/usr/bin/env bash
# =============================================================
# scripts/smoke-unauth.sh — PR D-1 unauth probe matrix
# =============================================================
#
# Hits every admin route + /api/invite/accept with no cookie and
# asserts none returns 2xx. A 2xx without cookies on any admin
# route is a critical gate failure (security findings S2 + S7).
#
# Expected status codes:
#   GET /api/admin/users                          -> 401
#   POST /api/admin/users/<email>/role            -> 401 (or 403 origin_rejected)
#   POST /api/admin/users/<email>/disable         -> 401
#   POST /api/admin/users/<email>/enable          -> 401
#   GET /api/admin/invites                        -> 401
#   POST /api/admin/invites                       -> 401
#   POST /api/admin/invites/<uuid>/revoke         -> 401
#   GET /api/admin/access-requests                -> 401
#   POST /api/admin/access-requests/<uuid>/resolve -> 401
#   POST /api/invite/accept                       -> 401 (Supabase session required)
#
# Origin header: each POST sets a valid production-allowlist
# Origin so we don't get short-circuited by the CSRF gate before
# requireRole — we want to verify requireRole fires on no cookie,
# not Origin-rejection. The Origin allowlist exact-matches the
# canonical production URL.
#
# Usage:
#   bash scripts/smoke-unauth.sh https://<preview>.vercel.app
#
# Exits 0 if all probes return non-2xx; exits 1 with offending
# routes printed otherwise.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <base-url>" >&2
  exit 2
fi

BASE="$1"
ORIGIN="https://workbook.clixsy.com"
DUMMY_EMAIL="test%2Bprd-d1-smoke%40clixsy.com"
DUMMY_UUID="00000000-0000-0000-0000-000000000000"

# probe(method path expected_code_pattern)
# expected_code_pattern: regex matching acceptable status codes
declare -a OFFENDERS=()

probe() {
  local method="$1"
  local path="$2"
  local label="$3"
  local args=(-s -o /dev/null -w "%{http_code}" -X "$method")
  args+=(-H "Origin: $ORIGIN")
  if [ "$method" != "GET" ]; then
    args+=(-H "Content-Type: application/json" -d '{}')
  fi
  local code
  code=$(curl "${args[@]}" "$BASE$path" 2>/dev/null)
  if [[ "$code" =~ ^2 ]]; then
    OFFENDERS+=("$label: HTTP $code (expected non-2xx)")
    printf "%-10s %-55s %s [FAIL]\n" "$method" "$path" "$code"
  else
    printf "%-10s %-55s %s\n" "$method" "$path" "$code"
  fi
}

echo "PR D-1 unauth smoke probe against $BASE"
echo "============================================================"
printf "%-10s %-55s %s\n" "Method" "Endpoint" "Code"
echo "------------------------------------------------------------"

probe GET  "/api/admin/users"                                  "list users"
probe POST "/api/admin/users/$DUMMY_EMAIL/role"                "set role"
probe POST "/api/admin/users/$DUMMY_EMAIL/disable"             "disable user"
probe POST "/api/admin/users/$DUMMY_EMAIL/enable"              "enable user"
probe GET  "/api/admin/invites"                                "list invites"
probe POST "/api/admin/invites"                                "create invite"
probe POST "/api/admin/invites/$DUMMY_UUID/revoke"             "revoke invite"
probe GET  "/api/admin/access-requests"                        "list access requests"
probe POST "/api/admin/access-requests/$DUMMY_UUID/resolve"    "resolve access request"
probe POST "/api/invite/accept"                                "accept invite"

echo "------------------------------------------------------------"

if [ ${#OFFENDERS[@]} -gt 0 ]; then
  echo ""
  echo "FAIL: ${#OFFENDERS[@]} route(s) returned 2xx without auth:"
  for offender in "${OFFENDERS[@]}"; do
    echo "  - $offender"
  done
  exit 1
fi

echo ""
echo "OK: all probes returned non-2xx."
