function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

export const config = {
  /** Superuser connection to the `postgres` maintenance database. */
  databaseUrl: required("DATABASE_URL"),
  /** Password for the dashboard login. */
  adminPassword: required("ADMIN_PASSWORD"),
  /** Secret used to sign the login cookie. */
  sessionSecret: required("SESSION_SECRET"),
  /** Hostname clients connect to; used in the connection URIs shown in the dashboard. */
  publicHost: required("PUBLIC_HOST"),
  publicPort: process.env.PUBLIC_PORT ?? "5432",
  listenPort: Number(process.env.PORT ?? 3000),
};
