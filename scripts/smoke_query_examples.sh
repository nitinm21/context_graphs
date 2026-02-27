#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
FIXTURES_PATH="${2:-data/derived/query_examples.json}"
CURL_RETRY_COUNT="${CURL_RETRY_COUNT:-4}"
CURL_RETRY_DELAY="${CURL_RETRY_DELAY:-1}"
HTTP_CODE_MARKER="__HTTP_CODE__:"

if [[ ! -f "$FIXTURES_PATH" ]]; then
  echo "error: fixtures file not found: $FIXTURES_PATH" >&2
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required for smoke_query_examples.sh" >&2
  exit 2
fi

total=0
passed=0
failed=0

echo "Query API smoke test against ${BASE_URL%/}/api/query"

while IFS= read -r fixture_json; do
  total=$((total + 1))
  query_id="$(printf '%s' "$fixture_json" | jq -r '.query_id')"
  question="$(printf '%s' "$fixture_json" | jq -r '.question')"
  expected_query_type="$(printf '%s' "$fixture_json" | jq -r '.query_type_expected')"
  expected_mode="$(printf '%s' "$fixture_json" | jq -r '.mode_expected')"
  include_baseline="$(printf '%s' "$fixture_json" | jq -r '.include_baseline_comparison // false')"

  req_body="$(jq -cn \
    --arg question "$question" \
    --arg preferred_mode "auto" \
    --argjson include_evidence true \
    --argjson include_baseline_comparison "$include_baseline" \
    '{question:$question, preferred_mode:$preferred_mode, include_evidence:$include_evidence, include_baseline_comparison:$include_baseline_comparison}')"

  curl_status=0
  raw_response="$(
    curl -sS -X POST "${BASE_URL%/}/api/query" \
      -H 'content-type: application/json' \
      --data "$req_body" \
      --max-time 20 \
      --retry "$CURL_RETRY_COUNT" \
      --retry-delay "$CURL_RETRY_DELAY" \
      --retry-connrefused \
      -w $'\n'"${HTTP_CODE_MARKER}"'%{http_code}\n'
  )" || curl_status=$?

  if [[ "$curl_status" -ne 0 ]]; then
    failed=$((failed + 1))
    echo "- ${query_id}: FAIL curl error (exit ${curl_status})"
    continue
  fi

  raw_trimmed="${raw_response%$'\n'}"
  http_line="${raw_trimmed##*$'\n'}"
  if [[ "$http_line" == "${HTTP_CODE_MARKER}"* ]]; then
    http_code="${http_line#${HTTP_CODE_MARKER}}"
    body="${raw_trimmed%$'\n'*}"
  else
    http_code=""
    body="$raw_response"
  fi

  if [[ "$http_code" != "200" ]]; then
    failed=$((failed + 1))
    echo "- ${query_id}: FAIL HTTP ${http_code}: $(printf '%s' "$body" | head -c 220)"
    continue
  fi

  if ! printf '%s' "$body" | jq -e '
      has("question") and has("query_type") and has("mode_used") and has("answer_text") and has("confidence") and
      has("entities_used") and has("events_used") and has("state_changes_used") and has("evidence_refs") and
      has("reasoning_notes") and has("baseline_comparison")
    ' >/dev/null; then
    failed=$((failed + 1))
    echo "- ${query_id}: FAIL invalid response contract shape"
    continue
  fi

  actual_query_type="$(printf '%s' "$body" | jq -r '.query_type')"
  actual_mode="$(printf '%s' "$body" | jq -r '.mode_used')"

  mismatch=""
  if [[ "$actual_query_type" != "$expected_query_type" ]]; then
    mismatch="query_type expected ${expected_query_type}, got ${actual_query_type}"
  fi
  if [[ "$actual_mode" != "$expected_mode" ]]; then
    mismatch="${mismatch:+${mismatch}; }mode expected ${expected_mode}, got ${actual_mode}"
  fi
  if [[ "$include_baseline" == "true" ]]; then
    baseline_type="$(printf '%s' "$body" | jq -r 'if .baseline_comparison == null then "null" else "object" end')"
    if [[ "$baseline_type" != "object" ]]; then
      mismatch="${mismatch:+${mismatch}; }expected baseline_comparison object, got null"
    fi
  fi

  if [[ -n "$mismatch" ]]; then
    failed=$((failed + 1))
    echo "- ${query_id}: FAIL ${mismatch}"
    continue
  fi

  passed=$((passed + 1))
  events_used_count="$(printf '%s' "$body" | jq '.events_used | length')"
  state_changes_count="$(printf '%s' "$body" | jq '.state_changes_used | length')"
  evidence_count="$(printf '%s' "$body" | jq '.evidence_refs | length')"
  echo "- ${query_id}: PASS type=${actual_query_type} mode=${actual_mode} events=${events_used_count} state_changes=${state_changes_count} evidence=${evidence_count}"
done < <(jq -c '.items[]' "$FIXTURES_PATH")

echo "Fixtures: ${total} | Passed: ${passed} | Failed: ${failed}"

if [[ "$failed" -gt 0 ]]; then
  exit 1
fi
