import { randomBytes } from "node:crypto";
import pg from "pg";
import { config } from "./config.js";

/** An error whose message is safe to show to the user. */
export class UserError extends Error {}

export interface Database {
  name: string;
  password: string;
  createdAt: Date;
}

const NAME_RE = /^[a-z][a-z0-9_]{0,62}$/;
const RESERVED = new Set(["postgres", "template0", "template1"]);
const REGISTRY = "unlimited_db_registry";

// The postgres container only accepts TLS connections; the cert is self-signed.
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  // (`sslmode=disable` in DATABASE_URL overrides this, which is handy for local testing.)
  ssl: { rejectUnauthorized: false },
});

// An idle connection dropping (e.g. postgres restarting) must not crash the process.
pool.on("error", (err) => console.error("postgres pool error:", err.message));

/** Creates the registry table that remembers each database's password. */
export async function init(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${REGISTRY} (
      name       text PRIMARY KEY,
      password   text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function list(): Promise<Database[]> {
  const { rows } = await pool.query<{ name: string; password: string; created_at: Date }>(
    `SELECT name, password, created_at FROM ${REGISTRY} ORDER BY created_at DESC`,
  );
  return rows.map((r) => ({ name: r.name, password: r.password, createdAt: r.created_at }));
}

export function validateName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new UserError("Name is required.");
  if (!NAME_RE.test(name)) {
    throw new UserError(
      "Name must start with a letter and contain only lowercase letters, digits and underscores (max 63 characters).",
    );
  }
  if (RESERVED.has(name)) throw new UserError(`"${name}" is reserved.`);
  return name;
}

/**
 * Creates a database plus a same-named role that owns it. Only that role
 * (and the superuser) can connect to it.
 */
export async function create(rawName: string): Promise<Database> {
  const name = validateName(rawName);
  const password = randomBytes(24).toString("base64url");
  const client = await pool.connect();
  const ident = client.escapeIdentifier(name);

  try {
    const existing = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = $1
       UNION ALL
       SELECT 1 FROM pg_roles WHERE rolname = $1
       UNION ALL
       SELECT 1 FROM ${REGISTRY} WHERE name = $1`,
      [name],
    );
    if (existing.rowCount) throw new UserError(`"${name}" already exists.`);

    // CREATE DATABASE cannot run inside a transaction, so clean up manually on failure.
    let roleCreated = false;
    let dbCreated = false;
    try {
      await client.query(`CREATE ROLE ${ident} LOGIN PASSWORD ${client.escapeLiteral(password)}`);
      roleCreated = true;
      await client.query(`CREATE DATABASE ${ident} OWNER ${ident}`);
      dbCreated = true;
      await client.query(`REVOKE CONNECT ON DATABASE ${ident} FROM PUBLIC`);
      const { rows } = await client.query<{ created_at: Date }>(
        `INSERT INTO ${REGISTRY} (name, password) VALUES ($1, $2) RETURNING created_at`,
        [name, password],
      );
      return { name, password, createdAt: rows[0].created_at };
    } catch (err) {
      if (dbCreated) await client.query(`DROP DATABASE IF EXISTS ${ident} WITH (FORCE)`).catch(() => {});
      if (roleCreated) await client.query(`DROP ROLE IF EXISTS ${ident}`).catch(() => {});
      throw err;
    }
  } finally {
    client.release();
  }
}

/** Drops the database (disconnecting anyone using it) and its role. */
export async function drop(rawName: string): Promise<void> {
  const name = validateName(rawName);
  const client = await pool.connect();
  const ident = client.escapeIdentifier(name);
  try {
    const known = await client.query(`SELECT 1 FROM ${REGISTRY} WHERE name = $1`, [name]);
    if (!known.rowCount) throw new UserError(`"${name}" is not managed by this dashboard.`);

    await client.query(`DROP DATABASE IF EXISTS ${ident} WITH (FORCE)`);
    await client.query(`DROP ROLE IF EXISTS ${ident}`);
    await client.query(`DELETE FROM ${REGISTRY} WHERE name = $1`, [name]);
  } finally {
    client.release();
  }
}

export function connectionUri(db: Database): string {
  return `postgres://${db.name}:${db.password}@${config.publicHost}:${config.publicPort}/${db.name}?sslmode=require`;
}

export async function close(): Promise<void> {
  await pool.end();
}
