# unlimited-db

A tiny self-hosted Postgres "database factory". Install it on one Linux server, then whenever a new project needs a database:

1. Open `https://your-domain` and sign in with the admin password.
2. Type a name, click **Create**.
3. Copy the connection URI into your project.

Each database gets its own Postgres role that owns it and is the only role (besides the superuser) allowed to connect to it. Delete a database and its role goes with it.

## Install (Ubuntu 24.04 LTS)

Before you start, create a DNS **A record** (e.g. `db.example.com`) pointing at the server's IP. Ports **80**, **443** and **5432** must be reachable from the internet (check your DigitalOcean cloud firewall if you use one).

```bash
git clone <this-repo> /opt/unlimited-db
cd /opt/unlimited-db
sudo ./install.sh
```

The installer:

- installs Docker (from Ubuntu's own packages) if it isn't there,
- asks for your domain and an admin password (leave blank to have one generated),
- generates the Postgres superuser password and a cookie-signing secret,
- writes them to `.env` (mode 600), and
- builds and starts everything with `docker compose up -d --build`.

A minute later the dashboard is at `https://your-domain`. Caddy obtains a Let's Encrypt certificate automatically once DNS resolves; if you ran the installer before DNS propagated, it keeps retrying on its own.

Non-interactive install (e.g. from DigitalOcean *user data*): `DOMAIN=db.example.com ADMIN_PASSWORD=... sudo -E ./install.sh`.

Re-running `install.sh` is safe: it keeps the existing `.env` and just rebuilds/restarts.

## Using it

The dashboard lists every database it has created with its connection URI:

```
postgres://<name>:<password>@<your-domain>:5432/<name>?sslmode=require
```

Names must be lowercase letters, digits and underscores, starting with a letter (so they never need quoting). `postgres`, `template0` and `template1` are reserved.

**Delete** drops the database (kicking off any open connections) and its role. There is no undo.

### TLS and the self-signed certificate

Postgres only accepts TLS connections; non-TLS attempts are rejected. The certificate is self-signed, so:

- `psql`, and anything built on libpq (Python `psycopg`, Ruby `pg`, Go `lib/pq`/`pgx`, Rust `sqlx`, …) work as-is with `sslmode=require` — it encrypts without verifying the certificate.
- **Node `pg`** treats `sslmode=require` as "verify" and will reject the self-signed certificate. Use `?sslmode=no-verify` instead (or `?uselibpqcompat=true&sslmode=require`).
- Prisma: append `&sslaccept=accept_invalid_certs`.

## How it works

```
                 ┌──────────── docker compose ────────────┐
 https :443 ───▶ │ caddy ──▶ app (Fastify + pg)           │
                 │                │ superuser, TLS         │
 postgres :5432 ▶│                ▼                        │
                 │            postgres:18  (volume pgdata) │
                 └─────────────────────────────────────────┘
```

| Piece | What it is |
| --- | --- |
| `postgres/` | Official `postgres:18` image plus `init-tls.sh`, which runs once on first boot: generates a 10-year self-signed cert inside the data directory, turns `ssl = on`, and rewrites `pg_hba.conf` so every TCP connection must be `hostssl`. |
| `app/` | The dashboard. Single admin password, one signed `HttpOnly`/`SameSite=Strict` session cookie (30 days). Talks to Postgres as the superuser over the internal Docker network. |
| `Caddyfile` | Reverse proxy with automatic HTTPS for `$DOMAIN`. |
| `install.sh` | The Ubuntu installer described above. |
| `.env` | All secrets. Created by the installer, never committed. |

**Where passwords live.** To show you a database's URI later, the app must remember its password. They are stored in plain text in a table `unlimited_db_registry` inside the `postgres` maintenance database on the server — the same box that already holds the superuser credentials, so this adds no new exposure, but do treat the server and `.env` as sensitive.

**Firewall note.** Docker publishes ports directly via iptables and bypasses `ufw`, so `ufw` rules neither help nor hinder here. Use the DigitalOcean cloud firewall if you want to restrict 5432 to specific IPs.

## Day-to-day operations

All commands run from `/opt/unlimited-db`.

```bash
docker compose ps                          # status
docker compose logs -f app                 # dashboard logs
docker compose logs -f postgres            # postgres logs
docker compose down && docker compose up -d   # restart
git pull && docker compose up -d --build   # update to a newer version of this repo
```

**Change the admin password:** edit `ADMIN_PASSWORD` in `.env`, then `docker compose up -d`.

**Backup:** the data lives in the Docker volume `unlimited-db_pgdata`. A logical dump of everything:

```bash
docker compose exec postgres pg_dumpall -U postgres > backup.sql
```

**Upgrading Postgres to a new major version** (e.g. 18 → 19) is *not* automatic — a new major cannot read the old data directory. When you want to, dump with `pg_dumpall` as above, change `FROM postgres:18` in `postgres/Dockerfile`, `docker compose down -v` (destroys the data!), `docker compose up -d --build`, then restore with `docker compose exec -T postgres psql -U postgres < backup.sql`. Minor/patch updates are picked up by `docker compose pull && docker compose up -d --build`.

**Uninstall:** `docker compose down -v` removes containers and all data; then delete the directory.

## Development

```bash
cd app && npm install && npm run build
DATABASE_URL='postgres://postgres:pw@localhost:5432/postgres?sslmode=disable' \
ADMIN_PASSWORD=dev SESSION_SECRET=devdevdevdevdevdevdevdevdevdevdev PUBLIC_HOST=localhost \
npm start          # http://localhost:3000
```

`sslmode=disable` in `DATABASE_URL` lets the app talk to a local Postgres without TLS.
