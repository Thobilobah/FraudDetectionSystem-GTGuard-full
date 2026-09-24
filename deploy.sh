#!/usr/bin/env bash
# Deploy both Vercel projects in one go (matches the CLI workflow used
# throughout: root -> gtguard-api, frontend/ -> gtguard-dashboard).
# Also invoked automatically by the local pre-push hook (backgrounded).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[1/2] Deploying backend (gtguard-api) ..."
(cd "$ROOT" && vercel --prod --yes)

echo "[2/2] Deploying dashboard (gtguard-dashboard) ..."
(cd "$ROOT/frontend" && vercel --prod --yes)

echo "Done."
echo "  API:       https://fraudguard-api-nine.vercel.app"
echo "  Dashboard: https://fraudguard-dashboard-eta.vercel.app"