#!/usr/bin/env bash
set -Eeuo pipefail

SITE_ARCHIVE="${1:?missing site archive}"
BACKEND_ARCHIVE="${2:?missing backend archive}"
SECRET_ENV="${3:?missing secret env}"
NGINX_TEMPLATE="${4:?missing nginx template}"
SITE_ROOT="${5:?missing site root}"
BACKEND_ROOT="${6:?missing backend root}"
SERVICE_NAME="${7:?missing service name}"
ACTIVE_CONFIG="${8:?missing active nginx config}"
DOMAIN="${9:?missing domain}"
PORT_START="${10:?missing port start}"
PORT_END="${11:?missing port end}"
INSTALLER_NAME="${12:?missing installer name}"

EXPECTED_SITE_ROOT="/opt/1panel/www/sites/${DOMAIN}"
EXPECTED_BACKEND_ROOT="/opt/ee2x/dv_export_support_site"
EXPECTED_ACTIVE_CONFIG="/opt/1panel/www/conf.d/${DOMAIN}.conf"

if [[ ! "$DOMAIN" =~ ^[a-z0-9.-]+$ ]]; then
  echo "invalid domain" >&2
  exit 2
fi
if [[ ! "$INSTALLER_NAME" =~ ^DV-EXPORT-v[0-9]+\.[0-9]+\.[0-9]+-setup\.exe$ ]]; then
  echo "invalid installer name" >&2
  exit 2
fi
if [[ "$SITE_ROOT" != "$EXPECTED_SITE_ROOT" || "$BACKEND_ROOT" != "$EXPECTED_BACKEND_ROOT" || "$ACTIVE_CONFIG" != "$EXPECTED_ACTIVE_CONFIG" ]]; then
  echo "deployment path validation failed" >&2
  exit 2
fi
if [[ ! "$PORT_START" =~ ^[0-9]+$ || ! "$PORT_END" =~ ^[0-9]+$ || "$PORT_START" -lt 1024 || "$PORT_END" -gt 65535 || "$PORT_START" -gt "$PORT_END" ]]; then
  echo "invalid port range" >&2
  exit 2
fi

STAMP="$(date +%Y%m%d_%H%M%S)"
WORK_ROOT="/tmp/dv_export_site_deploy_${STAMP}"
SITE_BACKUP="${SITE_ROOT}_backup_${STAMP}_codex_full_site"
BACKUP_PARENT="$(dirname "$BACKEND_ROOT")/backups"
BACKEND_BACKUP="${BACKUP_PARENT}/dv-export-support-site-${STAMP}"
CONFIG_BACKUP="${WORK_ROOT}/active-config.before"
HAD_ACTIVE_CONFIG=0
CONFIG_TOUCHED=0
DEPLOY_COMPLETED=0

cleanup() {
  local exit_code=$?
  trap - EXIT
  if [[ "$exit_code" -ne 0 && "$CONFIG_TOUCHED" -eq 1 && "$DEPLOY_COMPLETED" -eq 0 ]]; then
    restore_active_config || true
    if [[ -n "${OPENRESTY_CONTAINER:-}" ]]; then
      docker exec "$OPENRESTY_CONTAINER" openresty -t >/dev/null 2>&1 || true
      docker exec "$OPENRESTY_CONTAINER" openresty -s reload >/dev/null 2>&1 || true
    fi
  fi
  rm -rf "$WORK_ROOT"
  rm -f "$SITE_ARCHIVE" "$BACKEND_ARCHIVE" "$SECRET_ENV" "$NGINX_TEMPLATE"
  rm -f "$0"
  exit "$exit_code"
}
trap cleanup EXIT

port_is_used() {
  local port="$1"
  ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq ":${port}$"
}

choose_port() {
  local existing=""
  if [[ -f "$BACKEND_ROOT/.env" ]]; then
    existing="$(sed -n 's/^DV_EXPORT_SUPPORT_PORT=//p' "$BACKEND_ROOT/.env" | tail -n 1)"
  fi

  if [[ "$existing" =~ ^[0-9]+$ ]]; then
    if systemctl is-active --quiet "$SERVICE_NAME"; then
      printf '%s' "$existing"
      return
    fi
    if ! port_is_used "$existing"; then
      printf '%s' "$existing"
      return
    fi
  fi

  local candidate
  for ((candidate = PORT_START; candidate <= PORT_END; candidate++)); do
    if ! port_is_used "$candidate"; then
      printf '%s' "$candidate"
      return
    fi
  done

  echo "no free port in ${PORT_START}-${PORT_END}" >&2
  exit 3
}

set_env_value() {
  local env_path="$1"
  local key="$2"
  local value="$3"
  if grep -q "^${key}=" "$env_path"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$env_path"
  else
    printf '%s=%s\n' "$key" "$value" >> "$env_path"
  fi
}

restore_active_config() {
  if [[ "$HAD_ACTIVE_CONFIG" -eq 1 && -f "$CONFIG_BACKUP" ]]; then
    cp -f "$CONFIG_BACKUP" "$ACTIVE_CONFIG"
  else
    rm -f "$ACTIVE_CONFIG"
  fi
}

OPENRESTY_CONTAINER="$(docker ps --format '{{.Names}}' | grep -i openresty | head -n 1)"
if [[ -z "$OPENRESTY_CONTAINER" ]]; then
  echo "openresty container not found" >&2
  exit 4
fi

CHOSEN_PORT="$(choose_port)"
ADMIN_TOKEN="$(sed -n 's/^DV_EXPORT_SPONSOR_ADMIN_TOKEN=//p' "$SECRET_ENV" | tail -n 1)"
if [[ -z "$ADMIN_TOKEN" ]]; then
  echo "admin token was not found in secret env" >&2
  exit 5
fi

mkdir -p "$WORK_ROOT/site" "$WORK_ROOT/backend" "$BACKUP_PARENT"
tar -xzf "$SITE_ARCHIVE" -C "$WORK_ROOT/site"
tar -xzf "$BACKEND_ARCHIVE" -C "$WORK_ROOT/backend"

for required in \
  "$WORK_ROOT/site/index.html" \
  "$WORK_ROOT/site/sponsors.html" \
  "$WORK_ROOT/site/sponsors-admin.html" \
  "$WORK_ROOT/site/demo/index.html" \
  "$WORK_ROOT/site/downloads/$INSTALLER_NAME" \
  "$WORK_ROOT/backend/app/main.py" \
  "$WORK_ROOT/backend/requirements.txt"; do
  if [[ ! -f "$required" ]]; then
    echo "required deployment file missing: $required" >&2
    exit 6
  fi
done

available_kb="$(df -Pk "$(dirname "$SITE_ROOT")" | awk 'NR == 2 {print $4}')"
if [[ -z "$available_kb" || "$available_kb" -lt 500000 ]]; then
  echo "insufficient disk space for safe deployment" >&2
  exit 7
fi

if [[ -d "$SITE_ROOT" ]]; then
  cp -a "$SITE_ROOT" "$SITE_BACKUP"
fi
if [[ -d "$BACKEND_ROOT" ]]; then
  cp -a "$BACKEND_ROOT" "$BACKEND_BACKUP"
fi
if [[ -f "$ACTIVE_CONFIG" ]]; then
  cp -f "$ACTIVE_CONFIG" "$CONFIG_BACKUP"
  HAD_ACTIVE_CONFIG=1
fi

mkdir -p "$BACKEND_ROOT"
rm -rf \
  "$BACKEND_ROOT/app" \
  "$BACKEND_ROOT/systemd" \
  "$BACKEND_ROOT/tests" \
  "$BACKEND_ROOT/requirements.txt" \
  "$BACKEND_ROOT/README.md" \
  "$BACKEND_ROOT/.env.example"
cp -a "$WORK_ROOT/backend/." "$BACKEND_ROOT/"
mkdir -p "$BACKEND_ROOT/db"

if ! python3 -m venv "$BACKEND_ROOT/.venv"; then
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "python venv is unavailable and apt-get was not found" >&2
    exit 8
  fi
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-venv
  rm -rf "$BACKEND_ROOT/.venv"
  python3 -m venv "$BACKEND_ROOT/.venv"
fi
"$BACKEND_ROOT/.venv/bin/pip" install --disable-pip-version-check --quiet -r "$BACKEND_ROOT/requirements.txt"

ENV_PATH="$BACKEND_ROOT/.env"
if [[ ! -f "$ENV_PATH" ]]; then
  umask 077
  : > "$ENV_PATH"
fi
set_env_value "$ENV_PATH" DV_EXPORT_SUPPORT_HOST 127.0.0.1
set_env_value "$ENV_PATH" DV_EXPORT_SUPPORT_PORT "$CHOSEN_PORT"
set_env_value "$ENV_PATH" DV_EXPORT_SUPPORT_DB_PATH "$BACKEND_ROOT/db/dv_export_support.sqlite3"
set_env_value "$ENV_PATH" DV_EXPORT_SPONSOR_ADMIN_TOKEN "$ADMIN_TOKEN"
set_env_value "$ENV_PATH" DV_EXPORT_SUPPORT_ALLOWED_ORIGINS "https://${DOMAIN}"
chmod 600 "$ENV_PATH"

cat > "/etc/systemd/system/$SERVICE_NAME" <<EOF
[Unit]
Description=DV EXPORT website sponsor API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$BACKEND_ROOT
EnvironmentFile=$ENV_PATH
ExecStart=$BACKEND_ROOT/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port $CHOSEN_PORT
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null
systemctl restart "$SERVICE_NAME"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:${CHOSEN_PORT}/api/dv-export-support/v1/health" >/dev/null; then
    break
  fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE_NAME"
curl -fsS "http://127.0.0.1:${CHOSEN_PORT}/api/dv-export-support/v1/health" >/dev/null
curl -fsS "http://127.0.0.1:${CHOSEN_PORT}/api/dv-export-support/v1/sponsors" >/dev/null

mkdir -p "$SITE_ROOT"
find "$SITE_ROOT" -mindepth 1 -maxdepth 1 ! -name ssl ! -name renew-cert.sh -exec rm -rf -- {} +
cp -a "$WORK_ROOT/site/." "$SITE_ROOT/"
mkdir -p "$SITE_ROOT/ssl"

CERT_LIVE_ROOT="/opt/APP/certbot/etc/live/${DOMAIN}"
if [[ ! -f "$CERT_LIVE_ROOT/fullchain.pem" || ! -f "$CERT_LIVE_ROOT/privkey.pem" ]]; then
  CONFIG_TOUCHED=1
  cat > "$ACTIVE_CONFIG" <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location ^~ /.well-known/acme-challenge/ {
        allow all;
        root /usr/share/nginx/html;
    }

    location / {
        root /www/sites/$DOMAIN;
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
  if ! docker exec "$OPENRESTY_CONTAINER" openresty -t; then
    restore_active_config
    docker exec "$OPENRESTY_CONTAINER" openresty -t
    exit 9
  fi
  docker exec "$OPENRESTY_CONTAINER" openresty -s reload

  docker run --rm \
    -v /opt/1panel/apps/openresty/openresty/root:/webroot:rw \
    -v /opt/APP/certbot/etc:/etc/letsencrypt:rw \
    -v /opt/APP/certbot/lib:/var/lib/letsencrypt:rw \
    certbot/certbot certonly \
    --webroot -w /webroot \
    --cert-name "$DOMAIN" -d "$DOMAIN" \
    --non-interactive --agree-tos --register-unsafely-without-email
fi

cp -f "$CERT_LIVE_ROOT/fullchain.pem" "$SITE_ROOT/ssl/fullchain.pem"
cp -f "$CERT_LIVE_ROOT/privkey.pem" "$SITE_ROOT/ssl/privkey.pem"
chmod 644 "$SITE_ROOT/ssl/fullchain.pem"
chmod 600 "$SITE_ROOT/ssl/privkey.pem"

RENDERED_CONFIG="$WORK_ROOT/${DOMAIN}.conf"
sed -e "s/__DOMAIN__/${DOMAIN}/g" -e "s/__BACKEND_PORT__/${CHOSEN_PORT}/g" "$NGINX_TEMPLATE" > "$RENDERED_CONFIG"
grep -q "proxy_pass http://127.0.0.1:${CHOSEN_PORT};" "$RENDERED_CONFIG"
cp -f "$RENDERED_CONFIG" "$ACTIVE_CONFIG"
CONFIG_TOUCHED=1
if ! docker exec "$OPENRESTY_CONTAINER" openresty -t; then
  restore_active_config
  docker exec "$OPENRESTY_CONTAINER" openresty -t
  docker exec "$OPENRESTY_CONTAINER" openresty -s reload
  exit 10
fi
docker exec "$OPENRESTY_CONTAINER" openresty -s reload

cat > "$SITE_ROOT/renew-cert.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail

docker run --rm \
  -v /opt/1panel/apps/openresty/openresty/root:/webroot:rw \
  -v /opt/APP/certbot/etc:/etc/letsencrypt:rw \
  -v /opt/APP/certbot/lib:/var/lib/letsencrypt:rw \
  certbot/certbot renew --quiet

cp -f /opt/APP/certbot/etc/live/$DOMAIN/fullchain.pem $SITE_ROOT/ssl/fullchain.pem
cp -f /opt/APP/certbot/etc/live/$DOMAIN/privkey.pem $SITE_ROOT/ssl/privkey.pem
chmod 644 $SITE_ROOT/ssl/fullchain.pem
chmod 600 $SITE_ROOT/ssl/privkey.pem

container=\$(docker ps --format '{{.Names}}' | grep '^1Panel-openresty-' | head -n 1)
docker exec "\$container" openresty -t
docker exec "\$container" openresty -s reload
EOF
chmod 700 "$SITE_ROOT/renew-cert.sh"

CRON_LINE="29 5 * * * /bin/bash $SITE_ROOT/renew-cert.sh >> /var/log/dv-ee2x-cert-renew.log 2>&1"
{
  (crontab -l 2>/dev/null || true) | grep -v -F "$SITE_ROOT/renew-cert.sh" || true
  printf '%s\n' "$CRON_LINE"
} | crontab -

DEPLOY_COMPLETED=1

printf 'DEPLOY_PORT=%s\n' "$CHOSEN_PORT"
printf 'SITE_ROOT=%s\n' "$SITE_ROOT"
printf 'BACKEND_ROOT=%s\n' "$BACKEND_ROOT"
printf 'SERVICE_NAME=%s\n' "$SERVICE_NAME"
if [[ -d "$SITE_BACKUP" ]]; then printf 'SITE_BACKUP=%s\n' "$SITE_BACKUP"; fi
if [[ -d "$BACKEND_BACKUP" ]]; then printf 'BACKEND_BACKUP=%s\n' "$BACKEND_BACKUP"; fi
