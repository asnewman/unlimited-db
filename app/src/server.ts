import { createHash, timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { config } from "./config.js";
import * as db from "./db.js";
import { dashboardPage, loginPage } from "./html.js";

const SESSION_COOKIE = "udb_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const app = Fastify({ logger: true, trustProxy: true });
await app.register(cookie, { secret: config.sessionSecret });
await app.register(formbody);

// --- auth -------------------------------------------------------------------

function passwordMatches(input: string): boolean {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(config.adminPassword).digest();
  return timingSafeEqual(a, b);
}

function isAuthenticated(req: FastifyRequest): boolean {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return false;
  const { valid, value } = req.unsignCookie(raw);
  if (!valid || !value) return false;
  const issuedAt = Number(value);
  return Number.isFinite(issuedAt) && Date.now() - issuedAt < SESSION_TTL_MS;
}

app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/login" || req.url.startsWith("/login?")) return;
  if (!isAuthenticated(req)) return reply.redirect("/login");
});

function redirectHome(reply: FastifyReply, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return reply.redirect(qs ? `/?${qs}` : "/");
}

// --- routes -----------------------------------------------------------------

app.get<{ Querystring: { error?: string } }>("/login", async (req, reply) => {
  return reply.type("text/html").send(loginPage(req.query.error ? "Wrong password." : undefined));
});

app.post<{ Body: { password?: string } }>("/login", async (req, reply) => {
  if (!passwordMatches(req.body?.password ?? "")) {
    req.log.warn({ ip: req.ip }, "failed login");
    return reply.redirect("/login?error=1");
  }
  reply.setCookie(SESSION_COOKIE, String(Date.now()), {
    signed: true,
    httpOnly: true,
    sameSite: "strict",
    secure: req.protocol === "https",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return reply.redirect("/");
});

app.post("/logout", async (_req, reply) => {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
  return reply.redirect("/login");
});

app.get<{ Querystring: { created?: string; deleted?: string; error?: string } }>("/", async (req, reply) => {
  const databases = await db.list();
  const { created, deleted, error } = req.query;
  const notice = error
    ? { kind: "err" as const, text: error }
    : created
      ? { kind: "ok" as const, text: `Created "${created}". Connection URI is below.` }
      : deleted
        ? { kind: "ok" as const, text: `Deleted "${deleted}".` }
        : undefined;
  return reply
    .type("text/html")
    .send(dashboardPage({ databases, uriFor: db.connectionUri, notice, highlight: created }));
});

app.post<{ Body: { name?: string } }>("/databases", async (req, reply) => {
  try {
    const created = await db.create(req.body?.name ?? "");
    req.log.info({ name: created.name }, "database created");
    return redirectHome(reply, { created: created.name });
  } catch (err) {
    return redirectHome(reply, { error: describe(err, "Could not create database") });
  }
});

app.post<{ Params: { name: string } }>("/databases/:name/delete", async (req, reply) => {
  try {
    await db.drop(req.params.name);
    req.log.info({ name: req.params.name }, "database deleted");
    return redirectHome(reply, { deleted: req.params.name });
  } catch (err) {
    return redirectHome(reply, { error: describe(err, "Could not delete database") });
  }
});

function describe(err: unknown, prefix: string): string {
  if (err instanceof db.UserError) return err.message;
  app.log.error(err);
  const detail = err instanceof Error ? err.message : String(err);
  return `${prefix}: ${detail}`;
}

// --- start ------------------------------------------------------------------

await db.init();
await app.listen({ port: config.listenPort, host: "0.0.0.0" });
