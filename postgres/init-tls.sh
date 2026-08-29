#!/bin/bash
# Runs once, as the postgres user, when the data directory is first initialised.
# 1. Generates a self-signed TLS certificate (valid 10 years) inside the data directory.
# 2. Turns TLS on.
# 3. Rewrites the entrypoint's "host all all all scram-sha-256" rule to "hostssl",
#    so every TCP connection must use TLS. Non-TLS connections are rejected.
set -euo pipefail

openssl req -new -x509 -days 3650 -nodes \
  -subj "/CN=unlimited-db" \
  -out "$PGDATA/server.crt" -keyout "$PGDATA/server.key" >/dev/null 2>&1
chmod 600 "$PGDATA/server.key"

cat >> "$PGDATA/postgresql.conf" <<'CONF'

# --- unlimited-db: require TLS ---
ssl = on
ssl_cert_file = 'server.crt'
ssl_key_file = 'server.key'
CONF

sed -i -E 's/^host([[:space:]]+all[[:space:]]+all[[:space:]]+all[[:space:]]+)/hostssl\1/' "$PGDATA/pg_hba.conf"

echo "unlimited-db: TLS certificate generated; TLS required for all TCP connections."
