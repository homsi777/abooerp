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
npm install

echo "Applying PostgreSQL migrations"
npm run server:migrate

echo "Building browser frontend"
npm run build

echo "Publishing frontend to: $FRONTEND_DIR"
sudo install -d -m 0755 "$FRONTEND_DIR"
sudo find "$FRONTEND_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
sudo cp -r dist/. "$FRONTEND_DIR/"
sudo chown -R "$WEB_OWNER" "$FRONTEND_DIR"

echo "Reloading Nginx"
sudo systemctl reload nginx

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
EOF
