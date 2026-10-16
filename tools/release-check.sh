#!/bin/bash
# RF Planner release validation gate.
# Usage:
#   tools/release-check.sh                 # validate the working tree as-is
#   tools/release-check.sh --require-clean # additionally refuse a dirty tree
# Never weakens or skips tests: any failure aborts with a non-zero status.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-}" = "--require-clean" ]; then
  echo "[0/4] Working tree must be clean for release tagging"
  test -z "$(git status --short)" || { echo "DIRTY TREE"; git status --short; exit 1; }
  echo "      clean"
fi

echo "[1/4] Engine tests (RF oracle, worker parity, migration evidence)"
node tools/rt3d/run-all.mjs

echo "[2/4] Product tests (workflow, volume, cloud, UX)"
for t in stage8a-integration stage8b-freshness stage9a-tomography \
  stage9b-cloud stage9c-multifloor stage9d-fog stage9e-bgclip \
  stage10a-unified stage10b-project stage10c-intensity stage10d-smoothing \
  slab-thickness; do
  echo "  -- $t"
  node "tools/rt3d/$t.test.mjs" > /tmp/opencode/release-check-last.log 2>&1 \
    || { echo "FAILED: $t"; tail -20 /tmp/opencode/release-check-last.log; exit 1; }
done
echo "  -- smoke"
node tools/rt3d/smoke.mjs > /tmp/opencode/release-check-last.log 2>&1 \
  || { echo "FAILED: smoke"; tail -20 /tmp/opencode/release-check-last.log; exit 1; }
echo "      product suites green"

echo "[3/4] Docker build"
docker compose up -d --build > /dev/null
sleep 2

echo "[4/4] HTTP smoke (/, worker, protocol)"
curl -sf http://localhost:8080/ > /dev/null
curl -sf http://localhost:8080/rt3d-worker.js > /dev/null
curl -sf http://localhost:8080/rt3d-core.js > /dev/null

echo "RELEASE CHECK PASSED"
