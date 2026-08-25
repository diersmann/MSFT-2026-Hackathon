#!/usr/bin/env bash
#
# Installs the Dispatch workflows into a playground repository.
#
# The workflows check out the engine from DISPATCH_ENGINE_REPO rather than
# vendoring a copy, so the rubric has exactly one source of truth. Only the YAML
# is copied here.
#
#   ./scripts/install-workflow.sh owner/playground
#
set -euo pipefail

REPO="${1:-}"
if [ -z "$REPO" ]; then
  echo "Usage: $0 <owner/repo>" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Cloning $REPO ..."
gh repo clone "$REPO" "$TMP/repo" -- --depth 1 >/dev/null 2>&1

mkdir -p "$TMP/repo/.github/workflows"

for workflow in readiness-lint.yml split.yml; do
  if [ -f "$ROOT/.github/workflows/$workflow" ]; then
    cp "$ROOT/.github/workflows/$workflow" "$TMP/repo/.github/workflows/$workflow"
    echo "  + .github/workflows/$workflow"
  fi
done

cd "$TMP/repo"

if git diff --quiet && git diff --cached --quiet; then
  echo "Already up to date."
  exit 0
fi

git add .github/workflows
git commit -q -m "Install Dispatch workflows (readiness lint, /split)"
git push -q

echo ""
echo "Installed. Remaining setup on $REPO:"
echo "  gh secret   set AZURE_OPENAI_ENDPOINT   --repo $REPO"
echo "  gh secret   set AZURE_OPENAI_API_KEY    --repo $REPO"
echo "  gh variable set DISPATCH_ENGINE_REPO    --repo $REPO --body <owner/engine-repo>"
echo "  gh variable set MODEL_SCORE             --repo $REPO --body <deployment>"
echo ""
echo "Without DISPATCH_ENGINE_REPO the workflow checks out the playground itself,"
echo "which has no engine — set it."
