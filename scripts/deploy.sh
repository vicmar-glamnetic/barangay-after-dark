#!/usr/bin/env bash
# Build and publish dist/ to the gh-pages branch of the "origin" remote.
# GitHub Pages then serves it at https://<user>.github.io/<repo>/
set -euo pipefail
cd "$(dirname "$0")/.."
REMOTE_URL="$(git remote get-url origin)"
npm run build
touch dist/.nojekyll
cd dist
rm -rf .git
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%MZ)"
git push -q -f "$REMOTE_URL" gh-pages
rm -rf .git
echo "Deployed to gh-pages."
