/**
 * The lobby's admin panel at `/admin`: review player reports and an account's
 * fair-play counters, and enter the sanctions a person decides on. Served by
 * the lobby itself on its WebSocket port, so `<zone>.washoi.net/admin` reaches
 * it through the same proxy and certificate as the lobby connection.
 *
 * Off unless `admin.json` in the data directory lists an admin
 * (AdminCredentials.ts). Plain server-rendered HTML with no script. Signed-in
 * sessions live in memory only, in an HttpOnly, Secure, SameSite=Strict
 * cookie scoped to `/admin`; every change is a POST that carries the
 * session's CSRF token, and failed sign-ins are rate limited per address.
 * Every action is logged with the admin's name, and a sanction records it.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { adminNames, checkAdmin } from "./AdminCredentials";
import {
  type FairPlayStore,
  MAX_ADDRESS_BAN_MS,
  type PlayerReport,
  type Sanction,
  type SanctionKind,
  type StoredFairPlay,
} from "./FairPlayStore";
import { clientAddress } from "./LobbyRules";
import type { PlayerStore } from "./PlayerStore";

export const ADMIN_PATH = "/admin";
const COOKIE = "washoi_admin";
/** A session lasts this long from sign-in, active or not. */
export const ADMIN_SESSION_MS = 2 * 60 * 60_000;
/** Failed sign-ins one address may make per window before it waits. */
export const ADMIN_LOGIN_LIMIT = 5;
export const ADMIN_LOGIN_WINDOW_MS = 15 * 60_000;
/** Failed sign-ins from everywhere per window, against a distributed guess. */
const GLOBAL_LOGIN_LIMIT = 50;
const MAX_BODY = 8 * 1024;
const MAX_REASON = 200;
const DAY_MS = 24 * 60 * 60_000;

interface Session {
  name: string;
  csrf: string;
  expiresAt: number;
  flash: string;
}

export interface AdminPanelOptions {
  /** Path of `admin.json`. */
  file: string;
  fairPlay: FairPlayStore;
  accounts: PlayerStore;
  /** After a ban: disconnect banned players now rather than within the minute. */
  onSanction?: () => void;
  now?: () => number;
}

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  // Not no-referrer: under it browsers send `Origin: null` on the panel's own
  // form posts, and sameOrigin could not tell them from another site's
  "Referrer-Policy": "same-origin",
  "Cache-Control": "no-store",
};

const escapeHtml = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

const when = (ms: number | null) =>
  ms === null ? "until lifted" : new Date(ms).toISOString().replace("T", " ").slice(0, 16);

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(Uint8Array.from(x), Uint8Array.from(y));
}

/** The panel's look: the game's colours, with system fonts (the page loads nothing). */
const STYLE = `
:root{color-scheme:dark;--bg:hsl(240,20%,5%);--panel:hsl(240,16%,9%);--raise:hsl(240,16%,13%);--line:hsl(240,20%,18%);
--fg:hsl(42,95%,92%);--muted:hsla(42,60%,85%,.6);--gold:hsl(45,100%,55%);--magenta:hsl(320,100%,62%);--cyan:hsl(180,90%,60%)}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1200px 600px at 10% -10%,hsla(260,60%,20%,.35),transparent 60%),var(--bg);
color:var(--fg);font:14px/1.5 system-ui,"Segoe UI",sans-serif;min-height:100vh}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 24px;
background:var(--panel);border-bottom:2px solid var(--gold);position:sticky;top:0;z-index:1}
h1{margin:0;font-size:15px;font-weight:800;letter-spacing:.18em;text-transform:uppercase}
h1 b{color:var(--gold)}
.who{display:flex;align-items:center;gap:10px;color:var(--muted)}
main{max-width:1240px;margin:0 auto;padding:24px;display:grid;gap:16px;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}
main>*{grid-column:1/-1}
.card{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:16px 18px;overflow-x:auto}
main>.card.half{grid-column:auto}
@media (max-width:820px){main>.card.half{grid-column:1/-1}}
h2,h3{margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--gold)}
h2 small,h3 small{color:var(--muted);letter-spacing:.04em;text-transform:none;font-weight:500;margin-left:6px}
h2.title{font-size:20px;letter-spacing:.04em;text-transform:none;color:var(--fg)}
p{margin:0 0 8px}.empty{color:var(--muted);font-style:italic}.note{color:var(--muted);font-size:13px;margin:10px 0 0}
a{color:var(--cyan);text-decoration:none}a:hover{text-decoration:underline}
.flash{background:hsla(45,100%,55%,.1);border:1px solid hsla(45,100%,55%,.4);border-left:4px solid var(--gold);
padding:10px 14px;border-radius:4px;margin:0}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:middle;white-space:nowrap}
td.wrap{white-space:normal;min-width:180px}
th{color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;border-bottom-color:var(--gold)}
tr:hover td{background:var(--raise)}
label{display:grid;gap:4px;color:var(--muted);font-size:12px;letter-spacing:.06em;text-transform:uppercase}
input,select{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:8px 10px;
text-transform:none;letter-spacing:normal}
input:focus,select:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px hsla(45,100%,55%,.2)}
button{font:inherit;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px;cursor:pointer;
color:hsl(250,40%,6%);background:var(--gold);border:1px solid var(--gold);border-radius:4px;padding:8px 14px}
button:hover{filter:brightness(1.1)}
button.danger{background:var(--magenta);border-color:var(--magenta);color:#fff}
button.quiet,td button,.who button{background:transparent;color:var(--fg);border-color:var(--line);padding:4px 10px}
button.quiet:hover,td button:hover,.who button:hover{border-color:var(--gold);color:var(--gold);filter:none}
form.inline{display:inline}form.row{display:flex;gap:8px}form.row input{flex:1;min-width:0}
form.row+form.row{margin-top:14px}
form.stack{display:grid;gap:10px;max-width:460px}form.stack button{justify-self:start}
form.stack+form.row{margin-top:14px}
details summary{cursor:pointer;color:var(--cyan)}code{display:block;white-space:normal;word-break:break-all;color:var(--muted);margin-top:6px}
main.login{grid-template-columns:1fr;max-width:380px;margin-top:12vh}
main.login .card{padding:24px}main.login form.stack{max-width:none}main.login form.stack button{justify-self:stretch}
`;

export class AdminPanel {
  private readonly sessions = new Map<string, Session>();
  private readonly failures = new Map<string, { count: number; resetAt: number }>();
  private globalFailures = { count: 0, resetAt: 0 };
  private readonly now: () => number;

  constructor(private readonly options: AdminPanelOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Whether `admin.json` lists anyone; without, `/admin` answers 404. */
  get enabled(): boolean {
    return adminNames(this.options.file).length > 0;
  }

  /** Serve the request if it is for the panel; false leaves it to the caller. */
  handle(req: IncomingMessage, res: ServerResponse): boolean {
    const url = new URL(req.url ?? "/", "http://lobby");
    if (url.pathname !== ADMIN_PATH && !url.pathname.startsWith(`${ADMIN_PATH}/`)) return false;
    if (!this.enabled) {
      this.send(res, 404, "Not found");
      return true;
    }
    this.route(req, res, url).catch((error) => {
      console.warn("[Admin] Request failed:", error);
      if (!res.headersSent) this.send(res, 500, "Something went wrong");
    });
    return true;
  }

  private async route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const session = this.session(req);
    const route = url.pathname.slice(ADMIN_PATH.length) || "/";
    if (req.method === "GET") {
      if (!session) return this.page(res, "Sign in", this.loginForm(""));
      if (route === "/") return this.page(res, "Fair play", this.dashboard(session), session);
      if (route === "/account") return this.page(res, "Account", this.accountPage(session, url.searchParams), session);
      return this.send(res, 404, "Not found");
    }
    if (req.method !== "POST") return this.send(res, 405, "Method not allowed");
    if (!this.sameOrigin(req)) return this.send(res, 403, "Cross-site request refused");
    const form = await this.readForm(req);
    if (!form) return this.send(res, 413, "Request too large");
    if (route === "/login") return this.login(req, res, form);
    if (!session || !sameText(form.get("csrf") ?? "", session.csrf)) {
      return this.redirect(res, ADMIN_PATH);
    }
    if (route === "/logout") {
      this.sessions.delete(this.cookieToken(req) ?? "");
      res.setHeader("Set-Cookie", `${COOKIE}=; Path=${ADMIN_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
      return this.redirect(res, ADMIN_PATH);
    }
    const back = this.act(session, route, form);
    if (back === null) return this.send(res, 404, "Not found");
    this.redirect(res, back);
  }

  // ── Sign-in ──

  private session(req: IncomingMessage): Session | null {
    const token = this.cookieToken(req);
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= this.now() || !adminNames(this.options.file).includes(session.name)) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  private cookieToken(req: IncomingMessage): string | null {
    for (const part of (req.headers.cookie ?? "").split(";")) {
      const [name, value] = part.trim().split("=");
      if (name === COOKIE && value && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
    }
    return null;
  }

  private limited(address: string): boolean {
    const now = this.now();
    const entry = this.failures.get(address);
    if (entry && entry.resetAt <= now) this.failures.delete(address);
    if (this.globalFailures.resetAt <= now) this.globalFailures = { count: 0, resetAt: now + ADMIN_LOGIN_WINDOW_MS };
    return (
      (this.failures.get(address)?.count ?? 0) >= ADMIN_LOGIN_LIMIT || this.globalFailures.count >= GLOBAL_LOGIN_LIMIT
    );
  }

  private fail(address: string): void {
    const now = this.now();
    const entry = this.failures.get(address) ?? { count: 0, resetAt: now + ADMIN_LOGIN_WINDOW_MS };
    entry.count += 1;
    this.failures.set(address, entry);
    this.globalFailures.count += 1;
  }

  private login(req: IncomingMessage, res: ServerResponse, form: URLSearchParams): void {
    const address = clientAddress(req);
    if (this.limited(address)) {
      this.page(res, "Sign in", this.loginForm("Too many failed sign-ins. Try again in 15 minutes."), null, 429);
      return;
    }
    const admin = checkAdmin(this.options.file, form.get("name") ?? "", form.get("password") ?? "");
    if (!admin) {
      this.fail(address);
      console.warn(`[Admin] Failed sign-in from ${address}`);
      this.page(res, "Sign in", this.loginForm("Wrong name or password."), null, 401);
      return;
    }
    this.failures.delete(address);
    for (const [token, s] of this.sessions) if (s.expiresAt <= this.now()) this.sessions.delete(token);
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, {
      name: admin,
      csrf: randomBytes(32).toString("base64url"),
      expiresAt: this.now() + ADMIN_SESSION_MS,
      flash: "",
    });
    console.log(`[Admin] ${admin} signed in from ${address}`);
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${token}; Path=${ADMIN_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_SESSION_MS / 1000}`,
    );
    this.redirect(res, ADMIN_PATH);
  }

  /**
   * A POST from another site is refused even before its token is checked. An
   * `Origin` of "null" (a privacy-restricted request) falls back on the
   * browser's Sec-Fetch-Site, which every current browser sends.
   */
  private sameOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    const site = req.headers["sec-fetch-site"];
    if (!origin) return site === undefined || site === "same-origin";
    if (origin === "null") return site === "same-origin";
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  private readForm(req: IncomingMessage): Promise<URLSearchParams | null> {
    return new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          resolve(null);
          req.destroy();
          return;
        }
        chunks.push(Uint8Array.from(chunk));
      });
      req.on("end", () => resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8"))));
      req.on("error", reject);
    });
  }

  // ── Actions ──

  /** Apply a change; the page to return to, or null for an unknown action. */
  private act(session: Session, route: string, form: URLSearchParams): string | null {
    const { fairPlay } = this.options;
    const accountId = Number(form.get("accountId"));
    const accountPage =
      Number.isSafeInteger(accountId) && accountId > 0 ? `${ADMIN_PATH}/account?id=${accountId}` : ADMIN_PATH;
    const reason = (form.get("reason") ?? "").trim().slice(0, MAX_REASON);
    const days = (form.get("days") ?? "").trim();
    const durationMs = days === "" ? null : Number(days) * DAY_MS;
    const say = (text: string) => {
      session.flash = text;
    };
    switch (route) {
      case "/sanction": {
        const kind = form.get("kind") as SanctionKind;
        if (!this.options.accounts.exists(accountId) || (kind !== "ban" && kind !== "ranked")) {
          say("No such account.");
        } else if (!reason) {
          say("A sanction needs a reason: the player is shown it.");
        } else if (durationMs !== null && !(durationMs > 0)) {
          say("Days must be a positive number, or empty for until lifted.");
        } else {
          const sanction = fairPlay.addSanction(accountId, kind, reason, durationMs, session.name);
          console.log(`[Admin] ${session.name} added ${kind} ${sanction.id} on account ${accountId}: ${reason}`);
          if (kind === "ban") this.options.onSanction?.();
          say(`${kind === "ban" ? "Banned" : "Restricted"} account ${accountId}.`);
        }
        return accountPage;
      }
      case "/lift": {
        const id = Number(form.get("id"));
        const lifted = fairPlay.liftSanction(id);
        if (lifted) console.log(`[Admin] ${session.name} lifted sanction ${id}`);
        say(lifted ? `Lifted sanction ${id}.` : "No sanction in force with that id.");
        return accountPage;
      }
      case "/close-report": {
        const id = Number(form.get("id"));
        const closed = fairPlay.closeReport(id);
        if (closed) console.log(`[Admin] ${session.name} closed report ${id}`);
        say(closed ? `Closed report ${id}.` : "No report with that id.");
        return form.get("back") === "account" ? accountPage : ADMIN_PATH;
      }
      case "/ban-address": {
        const address = (form.get("address") ?? "").trim();
        if (!address || !reason || durationMs === null || !(durationMs > 0) || durationMs > MAX_ADDRESS_BAN_MS) {
          say(`An address ban needs an address, a reason and 1-${MAX_ADDRESS_BAN_MS / DAY_MS} days.`);
        } else {
          fairPlay.banAddress(address, reason, durationMs);
          console.log(`[Admin] ${session.name} banned an address for ${days} days: ${reason}`);
          say(`Address banned for ${days} days.`);
        }
        return ADMIN_PATH;
      }
      case "/lift-address": {
        const lifted = fairPlay.liftAddressBan((form.get("address") ?? "").trim());
        if (lifted) console.log(`[Admin] ${session.name} lifted an address ban`);
        say(lifted ? "Address ban lifted." : "No ban on that address.");
        return ADMIN_PATH;
      }
      default:
        return null;
    }
  }

  // ── Pages ──

  private name(id: number): string {
    const name = this.options.accounts.nameOf(id);
    return `<a href="${ADMIN_PATH}/account?id=${id}">${escapeHtml(name ?? "?")} #${id}</a>`;
  }

  private csrfField(session: Session): string {
    return `<input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">`;
  }

  private button(session: Session, action: string, label: string, fields: Record<string, string | number>): string {
    const hidden = Object.entries(fields)
      .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
      .join("");
    return `<form method="post" action="${ADMIN_PATH}${action}" class="inline">${this.csrfField(session)}${hidden}<button>${escapeHtml(label)}</button></form>`;
  }

  private loginForm(message: string): string {
    return `${message ? `<p class="flash">${escapeHtml(message)}</p>` : ""}
<section class="card"><h2>Sign in</h2><form method="post" action="${ADMIN_PATH}/login" class="stack">
<label>Name <input name="name" autocomplete="username" required maxlength="32"></label>
<label>Password <input name="password" type="password" autocomplete="current-password" required></label>
<button>Sign in</button></form></section>`;
  }

  private reportRows(
    session: Session,
    reports: PlayerReport[],
    back: "dashboard" | "account",
    accountId?: number,
  ): string {
    if (reports.length === 0) return '<p class="empty">None.</p>';
    const rows = reports
      .map(
        (
          r,
        ) => `<tr><td>${r.id}</td><td>${when(r.createdAt)}</td><td>${this.name(r.reporterId)}</td><td>${this.name(r.reportedId)}</td>
<td>${escapeHtml(r.matchId ?? "")}</td><td class="wrap">${escapeHtml(r.reason)}</td><td>${
          r.closed
            ? "closed"
            : this.button(session, "/close-report", "Close", {
                id: r.id,
                back,
                ...(accountId ? { accountId } : {}),
              })
        }</td></tr>`,
      )
      .join("");
    return `<table><tr><th>#</th><th>When (UTC)</th><th>By</th><th>About</th><th>Match</th><th>Reason</th><th></th></tr>${rows}</table>`;
  }

  private active(s: Sanction): boolean {
    return s.liftedAt === null && (s.expiresAt === null || s.expiresAt > this.now());
  }

  private sanctionRows(session: Session, sanctions: Sanction[], showAccount: boolean): string {
    if (sanctions.length === 0) return '<p class="empty">None.</p>';
    const rows = sanctions
      .map(
        (s) => `<tr><td>${s.id}</td>${showAccount ? `<td>${this.name(s.accountId)}</td>` : ""}<td>${s.kind}</td>
<td class="wrap">${escapeHtml(s.reason)}</td><td>${when(s.createdAt)}</td><td>${s.liftedAt ? `lifted ${when(s.liftedAt)}` : when(s.expiresAt)}</td>
<td>${escapeHtml(s.by)}</td><td>${this.active(s) ? this.button(session, "/lift", "Lift", { id: s.id, accountId: s.accountId }) : ""}</td></tr>`,
      )
      .join("");
    return `<table><tr><th>#</th>${showAccount ? "<th>Account</th>" : ""}<th>Kind</th><th>Reason</th><th>From</th><th>Until</th><th>By</th><th></th></tr>${rows}</table>`;
  }

  private dashboard(session: Session): string {
    const { fairPlay } = this.options;
    const active = fairPlay.sanctions().filter((s) => this.active(s));
    const reports = fairPlay.openReports();
    return `<section class="card"><h2>Open reports <small>${reports.length}</small></h2>${this.reportRows(session, reports, "dashboard")}</section>
<section class="card"><h2>Sanctions in force <small>${active.length}</small></h2>${this.sanctionRows(session, active, true)}</section>
<section class="card half"><h2>Find an account</h2>
<form method="get" action="${ADMIN_PATH}/account" class="row"><input name="q" placeholder="Name or account id" required maxlength="32"><button>Open</button></form>
<p class="note">Names match in any capitals. A key cannot be looked up: only its hash is stored.</p></section>
<section class="card half"><h2>Address bans</h2>
<form method="post" action="${ADMIN_PATH}/ban-address" class="stack">${this.csrfField(session)}
<label>Address <input name="address" required maxlength="64"></label>
<label>Reason (shown to the player) <input name="reason" required maxlength="${MAX_REASON}"></label>
<label>Days (at most ${MAX_ADDRESS_BAN_MS / DAY_MS}) <input name="days" type="number" min="1" max="${MAX_ADDRESS_BAN_MS / DAY_MS}" required></label>
<button class="danger">Ban address</button></form>
<form method="post" action="${ADMIN_PATH}/lift-address" class="row">${this.csrfField(session)}
<input name="address" placeholder="Address to lift" required maxlength="64"><button class="quiet">Lift</button></form>
<p class="note">Addresses are kept only as keyed hashes, so bans cannot be listed; lift one by its address.</p></section>`;
  }

  private accountPage(session: Session, params: URLSearchParams): string {
    const { fairPlay, accounts } = this.options;
    const query = (params.get("id") ?? params.get("q") ?? "").trim();
    const byId = /^\d+$/.test(query) ? Number(query) : null;
    const id = byId !== null && accounts.exists(byId) ? byId : (accounts.findByName(query)?.id ?? null);
    if (id === null) {
      return `<section class="card"><p>No account matches “${escapeHtml(query)}”.</p><p><a href="${ADMIN_PATH}">← Back</a></p></section>`;
    }
    const sanctions = fairPlay.sanctions().filter((s) => s.accountId === id);
    return `<p><a href="${ADMIN_PATH}">← Reports</a></p>
<section class="card"><h2 class="title">${escapeHtml(accounts.nameOf(id) ?? "?")} <small>account #${id}</small></h2>
<h3>Sanctions</h3>${this.sanctionRows(session, sanctions, false)}</section>
<section class="card"><h3>Add a sanction</h3>
<form method="post" action="${ADMIN_PATH}/sanction" class="stack">${this.csrfField(session)}
<input type="hidden" name="accountId" value="${id}">
<label>Kind <select name="kind"><option value="ban">Ban from the servers</option><option value="ranked">Keep out of public rooms and the queue</option></select></label>
<label>Reason (shown to the player) <input name="reason" required maxlength="${MAX_REASON}"></label>
<label>Days (empty: until lifted) <input name="days" type="number" min="1"></label>
<button class="danger">Add sanction</button></form>
<p class="note">Decide only after reviewing the evidence: the counters are signals, not verdicts.</p></section>
<section class="card"><h3>Reports about this player</h3>${this.reportRows(session, fairPlay.reportsAbout(id), "account", id)}</section>
<section class="card"><h3>Match counters <small>last 90 days</small></h3>${this.matchRows(fairPlay.signalsFor(id))}</section>`;
  }

  private matchRows(matches: StoredFairPlay[]): string {
    if (matches.length === 0) return '<p class="empty">None.</p>';
    const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((100 * part) / whole)}%` : "–");
    const rows = matches
      .map((m) => {
        const s = m.signals;
        const n = (k: string) => s[k] ?? 0;
        const all = Object.entries(s)
          .map(([k, v]) => `${escapeHtml(k)}=${escapeHtml(v)}`)
          .join(" ");
        return `<tr><td>${when(m.endedAt)}</td><td>${escapeHtml(m.gametype)}</td><td>${n("shots")}</td><td>${pct(n("hits"), n("shots"))}</td>
<td>${pct(n("headshots"), n("hits"))}</td><td>${n("rejectedCmds")}</td><td>${n("clampedCmds")}</td><td>${n("backtrackCmds")}</td>
<td>${n("warpStrikes")}</td><td>${n("tripwireHits")}</td><td>${n("peakViewSpeedDps")}</td>
<td><details><summary>${escapeHtml(m.matchId)}</summary><code>${all}</code></details></td></tr>`;
      })
      .join("");
    return `<table><tr><th>Ended (UTC)</th><th>Mode</th><th>Shots</th><th>Hit</th><th>Head</th><th>Rejected</th><th>Clamped</th>
<th>Backtrack</th><th>Warp</th><th>Tripwire</th><th>Peak °/s</th><th>Match</th></tr>${rows}</table>`;
  }

  // ── Responses ──

  private page(res: ServerResponse, title: string, body: string, session: Session | null = null, status = 200): void {
    const flash = session?.flash ?? "";
    if (session) session.flash = "";
    const signedIn = session
      ? `<span>${escapeHtml(session.name)}</span> <form method="post" action="${ADMIN_PATH}/logout" class="inline">${this.csrfField(session)}<button>Sign out</button></form>`
      : "";
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Washoi admin · ${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><header><h1><b>Washoi</b> admin</h1><div class="who">${signedIn}</div></header>
<main${session ? "" : ' class="login"'}>${flash ? `<p class="flash">${escapeHtml(flash)}</p>` : ""}${body}</main></body></html>`;
    res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  }

  private redirect(res: ServerResponse, location: string): void {
    res.writeHead(303, { ...SECURITY_HEADERS, Location: location });
    res.end();
  }

  private send(res: ServerResponse, status: number, text: string): void {
    res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
    res.end(text);
  }
}
