#!/usr/bin/env bash
# تحقق وإصلاح شامل للدفter من 1/6 — يُشغَّل على VPS بعد git pull
set -euo pipefail
cd "$(dirname "$0")/.."

FROM_DATE="${1:-2026-06-01}"
REPORT="ledger-finance-verify-${FROM_DATE}-$(date +%Y%m%d).txt"

echo "=== Verify ledger finance from ${FROM_DATE} ==="
node server/scripts/verifyLedgerFinanceSinceDate.cjs "${FROM_DATE}" | tee "${REPORT}" || VERIFY_EXIT=$?

if [[ "${VERIFY_EXIT:-0}" -ne 0 ]]; then
  echo ""
  echo "=== Issues found — running repair ==="
  npx tsx server/src/scripts/repairLedgerFinanceSinceDate.ts "${FROM_DATE}"
  echo ""
  echo "=== Re-verify after repair ==="
  node server/scripts/verifyLedgerFinanceSinceDate.cjs "${FROM_DATE}" | tee "${REPORT}.after-repair.txt"
fi

echo ""
echo "Reports saved: ${REPORT}"
