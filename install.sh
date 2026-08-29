#!/usr/bin/env bash
# unlimited-db installer for a fresh Ubuntu 24.04 LTS server.
#
#   git clone <this repo> /opt/unlimited-db
#   cd /opt/unlimited-db
#   sudo ./install.sh
#
# Prompts for a domain and an admin password (or set DOMAIN / ADMIN_PASSWORD in
# the environment to run non-interactively). Safe to re-run: an existing .env is
# kept and the stack is simply rebuilt and restarted.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root: sudo ./install.sh" >&2
  exit 1
fi

cd "$(dirname "$(readlink -f "$0")")"

if ! command -v apt-get >/dev/null; then
  echo "This installer needs apt-get (Ubuntu/Debian)." >&2
  exit 1
fi
if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
    echo "Note: tested on Ubuntu 24.04; you are on ${PRETTY_NAME:-unknown}. Continuing anyway." >&2
  fi
fi

# --- 1. Docker ---------------------------------------------------------------
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo "==> Installing Docker"
  # On a fresh cloud server, cloud-init and unattended-upgrades run apt in the
  # background for the first few minutes and hold the dpkg lock. Wait for them.
  if command -v cloud-init >/dev/null; then
    echo "    Waiting for first-boot setup (cloud-init) to finish..."
    cloud-init status --wait >/dev/null 2>&1 || true
  fi
  APT_WAIT="-o DPkg::Lock::Timeout=600"
  apt-get $APT_WAIT update -q
  DEBIAN_FRONTEND=noninteractive apt-get $APT_WAIT install -y -q docker.io docker-compose-v2 openssl
fi
systemctl enable --now docker >/dev/null

# --- 2. Configuration ---------------------------------------------------------
if [[ -f .env ]]; then
  echo "==> Using existing .env"
else
  echo "==> Configuration"
  while [[ -z "${DOMAIN:-}" ]]; do
    read -rp "Domain that points at this server (e.g. db.example.com): " DOMAIN
  done
  if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
    read -rsp "Admin password for the dashboard (leave blank to generate one): " ADMIN_PASSWORD
    echo
  fi
  if [[ -z "$ADMIN_PASSWORD" ]]; then
    ADMIN_PASSWORD="$(openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | head -c 32)"
    echo "Generated admin password: $ADMIN_PASSWORD"
  fi
  if [[ "$ADMIN_PASSWORD" == *"'"* ]]; then
    echo "The admin password may not contain a single quote (')." >&2
    exit 1
  fi

  umask 077
  cat > .env <<ENV
DOMAIN=$DOMAIN
ADMIN_PASSWORD='$ADMIN_PASSWORD'
POSTGRES_PASSWORD=$(openssl rand -hex 24)
SESSION_SECRET=$(openssl rand -hex 32)
ENV
  echo "Wrote .env (mode 600). Keep it safe: it holds all passwords."
fi

# --- 3. Start ----------------------------------------------------------------
echo "==> Building and starting (this takes a minute the first time)"
docker compose up -d --build

# --- 4. Done -----------------------------------------------------------------
DOMAIN="$(sed -n 's/^DOMAIN=//p' .env)"
cat <<MSG

unlimited-db is running.

  Dashboard:  https://$DOMAIN
  Postgres:   $DOMAIN:5432 (TLS required)

Make sure DNS for $DOMAIN points at this server and that ports 80, 443 and 5432
are reachable (check your DigitalOcean cloud firewall if you use one). Caddy
obtains the HTTPS certificate automatically once DNS resolves.

The admin password is in $(pwd)/.env
MSG
