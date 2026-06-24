#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

USERNAME="${1:-rajeshsurunga}"
REPO="${2:-SubarnaPasal}"
REMOTE="https://github.com/${USERNAME}/${REPO}.git"

git remote set-url origin "$REMOTE"
echo "Remote: $REMOTE"

if command -v gh >/dev/null 2>&1; then
  if ! gh auth status >/dev/null 2>&1; then
    echo "Log in to GitHub..."
    gh auth login
  fi
  if gh repo view "${USERNAME}/${REPO}" >/dev/null 2>&1; then
    echo "Repo exists. Pushing..."
    git push -u origin main
  else
    echo "Creating GitHub repo ${USERNAME}/${REPO}..."
    gh repo create "$REPO" --public --source=. --remote=origin --push
  fi
  exit 0
fi

echo ""
echo "GitHub CLI (gh) not found. Do this manually:"
echo "  1. Open https://github.com/new?name=${REPO}"
echo "  2. Create an empty repo (no README, no .gitignore)"
echo "  3. Run: git push -u origin main"
echo ""

if git push -u origin main; then
  echo "Pushed to GitHub."
else
  echo "Push failed — create the repo first, then run: git push -u origin main"
  exit 1
fi
