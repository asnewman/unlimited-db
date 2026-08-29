import type { Database } from "./db.js";

export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         background: Canvas; color: CanvasText; }
  main { max-width: 960px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-bottom: 2rem; }
  h1 { font-size: 1.4rem; margin: 0; }
  h2 { font-size: 1.05rem; margin: 2rem 0 .75rem; }
  form.inline { display: inline; }
  input[type=text], input[type=password] { font: inherit; padding: .5rem .65rem; border: 1px solid GrayText;
         border-radius: 6px; background: Field; color: FieldText; min-width: 16rem; }
  button { font: inherit; padding: .5rem .9rem; border-radius: 6px; border: 1px solid GrayText;
           background: ButtonFace; color: ButtonText; cursor: pointer; }
  button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
  button.danger { color: #dc2626; border-color: #dc2626; background: transparent; }
  button.small { padding: .3rem .6rem; font-size: .85rem; }
  .row { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
  .notice { padding: .7rem 1rem; border-radius: 6px; margin-bottom: 1.25rem; border: 1px solid; }
  .notice.ok { border-color: #16a34a; color: #16a34a; }
  .notice.err { border-color: #dc2626; color: #dc2626; }
  ul.dbs { list-style: none; padding: 0; margin: 0; }
  li.db { border: 1px solid GrayText; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: .9rem; }
  li.db.highlight { border-color: #16a34a; }
  .db-head { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
  .db-name { font-weight: 600; font-size: 1.05rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .muted { color: GrayText; font-size: .85rem; }
  .uri { display: flex; gap: .5rem; margin-top: .75rem; }
  .uri input { flex: 1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85rem; min-width: 0; }
  .empty { color: GrayText; padding: 2rem 0; text-align: center; border: 1px dashed GrayText; border-radius: 8px; }
  .login { max-width: 22rem; margin: 15vh auto 0; }
  .login input { width: 100%; margin: .5rem 0 1rem; }
`;

const COPY_JS = `
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-copy]');
    if (!btn) return;
    const input = document.getElementById(btn.dataset.copy);
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select(); document.execCommand('copy');
    }
    const label = btn.textContent; btn.textContent = 'Copied';
    setTimeout(() => (btn.textContent = label), 1200);
  });
`;

function layout(title: string, body: string, script = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>${body}</main>
${script ? `<script>${script}</script>` : ""}
</body>
</html>`;
}

export function loginPage(error?: string): string {
  return layout(
    "Sign in · unlimited-db",
    `<div class="login">
      <h1>unlimited-db</h1>
      ${error ? `<p class="notice err">${esc(error)}</p>` : ""}
      <form method="post" action="/login">
        <label for="password">Admin password</label>
        <input id="password" type="password" name="password" autofocus autocomplete="current-password" required>
        <button class="primary" type="submit">Sign in</button>
      </form>
    </div>`,
  );
}

export interface DashboardProps {
  databases: Database[];
  uriFor: (db: Database) => string;
  notice?: { kind: "ok" | "err"; text: string };
  highlight?: string;
}

export function dashboardPage({ databases, uriFor, notice, highlight }: DashboardProps): string {
  const items = databases
    .map((db) => {
      const id = `uri-${esc(db.name)}`;
      return `<li class="db${db.name === highlight ? " highlight" : ""}" id="db-${esc(db.name)}">
        <div class="db-head">
          <span class="db-name">${esc(db.name)}</span>
          <span class="row">
            <span class="muted">created ${esc(db.createdAt.toISOString().slice(0, 10))}</span>
            <form class="inline" method="post" action="/databases/${encodeURIComponent(db.name)}/delete"
                  onsubmit="return confirm('Delete database &quot;${esc(db.name)}&quot; and all its data? This cannot be undone.')">
              <button class="danger small" type="submit">Delete</button>
            </form>
          </span>
        </div>
        <div class="uri">
          <input id="${id}" type="text" readonly value="${esc(uriFor(db))}" onfocus="this.select()">
          <button class="small" type="button" data-copy="${id}">Copy</button>
        </div>
      </li>`;
    })
    .join("\n");

  return layout(
    "unlimited-db",
    `<header>
      <h1>unlimited-db</h1>
      <form class="inline" method="post" action="/logout"><button class="small" type="submit">Sign out</button></form>
    </header>

    ${notice ? `<p class="notice ${notice.kind}">${esc(notice.text)}</p>` : ""}

    <h2>New database</h2>
    <form class="row" method="post" action="/databases">
      <input type="text" name="name" placeholder="my_project" autocomplete="off" required
             pattern="[a-z][a-z0-9_]{0,62}" title="Lowercase letters, digits and underscores; must start with a letter.">
      <button class="primary" type="submit">Create</button>
    </form>

    <h2>Databases (${databases.length})</h2>
    ${databases.length ? `<ul class="dbs">${items}</ul>` : `<p class="empty">No databases yet.</p>`}`,
    COPY_JS,
  );
}
