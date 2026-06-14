#!/usr/bin/env bash
set -euo pipefail

BRANCH="${ABOOERP_DEPLOY_BRANCH:-web-browser-mode}"
FRONTEND_DIR="${ABOOERP_FRONTEND_DIR:-/var/www/abooerp/frontend}"
WEB_OWNER="${ABOOERP_WEB_OWNER:-www-data:www-data}"
PUBLIC_URL="${ABOOERP_PUBLIC_URL:-http://65.21.136.217:2730}"

current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "$BRANCH" ]]; then
  echo "Deployment aborted: expected branch '$BRANCH', current branch is '$current_branch'." >&2
  exit 1
fi

case "$FRONTEND_DIR" in
  /var/www/*) ;;
  *)
    echo "Deployment aborted: frontend target must stay under /var/www." >&2
    exit 1
    ;;
esac

if [[ "$FRONTEND_DIR" == "/var/www" || "$FRONTEND_DIR" == "/" ]]; then
  echo "Deployment aborted: unsafe frontend target '$FRONTEND_DIR'." >&2
  exit 1
fi

echo "Pulling branch: $BRANCH"
git pull origin "$BRANCH"

echo "Installing dependencies"
PUPPETEER_SKIP_DOWNLOAD=true npm install

echo "Ensuring Chromium for server PDF export (Ubuntu)"
if command -v apt-get >/dev/null 2>&1; then
  if ! command -v chromium-browser >/dev/null 2>&1 && ! command -v chromium >/dev/null 2>&1; then
    sudo apt-get update -qq
    sudo apt-get install -y chromium-browser fonts-liberation fonts-noto-core || true
  fi
fi

echo "Applying PostgreSQL migrations"
npm run server:migrate

echo "Building browser frontend"
npm run build

echo "Building backend"
npm run server:build

echo "Publishing frontend to: $FRONTEND_DIR"
sudo install -d -m 0755 "$FRONTEND_DIR"
sudo find "$FRONTEND_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
sudo cp -r dist/. "$FRONTEND_DIR/"
sudo chown -R "$WEB_OWNER" "$FRONTEND_DIR"

echo "Reloading Nginx"
sudo nginx -t && sudo systemctl reload nginx

if command -v pm2 >/dev/null 2>&1; then
  echo "Restarting backend (pm2)"
  pm2 restart abooerp-backend --update-env
else
  echo "pm2 not found — restart backend manually: npm run server:prod:start"
fi

cat <<EOF

Web frontend deployed successfully.

Verify:
  ${PUBLIC_URL}/#/login
  ${PUBLIC_URL}/api/v1/system/lan-health

Backend process management is intentionally separate.
Start or restart it using your VPS process manager, or run:
  npm run server:start

Required backend environment:
  WEB_MODE_ENABLED=true
  MOBILE_MODE_ENABLED=true
  WEB_PUBLIC_ORIGINS=${PUBLIC_URL}
  PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
EOF
