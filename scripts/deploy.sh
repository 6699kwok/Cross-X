#!/usr/bin/env bash
# CrossX — one-shot production deploy for Ubuntu 22.04 LTS (阿里云/腾讯云)
# Run as root or a sudo-enabled user:
#   bash scripts/deploy.sh
set -euo pipefail

APP_DIR="/opt/crossx"
APP_USER="crossx"
DOMAIN="${DOMAIN:-your-domain.com}"   # override: DOMAIN=crossx.ai bash deploy.sh
NODE_VERSION="22"

echo "==> [1/8] System packages"
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx curl git

echo "==> [2/8] Node.js ${NODE_VERSION} via nvm (system-wide)"
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y -qq nodejs
fi
node -v && npm -v

echo "==> [3/8] PM2"
npm install -g pm2 --silent

echo "==> [4/8] App user + directory"
id "${APP_USER}" &>/dev/null || useradd --system --shell /bin/bash --home "${APP_DIR}" "${APP_USER}"
mkdir -p "${APP_DIR}" "${APP_DIR}/data" "${APP_DIR}/logs"

echo "==> [5/8] Copy app files"
# Run from the repo root:  DOMAIN=crossx.ai bash scripts/deploy.sh
rsync -a --exclude='node_modules' --exclude='.git' --exclude='data/*.db' \
  --exclude='data/*.json' --exclude='.env.local' \
  "$(dirname "$0")/../" "${APP_DIR}/"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

echo "==> [6/8] npm install (production)"
cd "${APP_DIR}"
sudo -u "${APP_USER}" npm install --production --silent

echo "==> [7/8] Nginx config"
cp "${APP_DIR}/nginx/crossx.conf" /etc/nginx/sites-available/crossx
sed -i "s/your-domain.com/${DOMAIN}/g" /etc/nginx/sites-available/crossx
ln -sf /etc/nginx/sites-available/crossx /etc/nginx/sites-enabled/crossx
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo ""
echo "==> [8/8] TLS via Let's Encrypt"
echo "    Run:  certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos -m admin@${DOMAIN}"
echo "    Then: systemctl reload nginx"
echo ""
echo "==> Next steps:"
echo "    1. Copy .env.local to ${APP_DIR}/.env.local and fill in all keys"
echo "    2. chown ${APP_USER}:${APP_USER} ${APP_DIR}/.env.local && chmod 600 ${APP_DIR}/.env.local"
echo "    3. cd ${APP_DIR} && sudo -u ${APP_USER} pm2 start ecosystem.config.js --env production"
echo "    4. pm2 save && pm2 startup"
echo "    5. pm2 logs crossx   # watch for startup errors"
echo ""
echo "DONE. Visit https://${DOMAIN} to verify."
