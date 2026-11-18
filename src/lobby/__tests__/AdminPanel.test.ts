/**
 * The admin panel over real HTTP: off without admin.json, sign-in with rate
 * limiting, CSRF and origin checks on every change, and a ban that reaches
 * the store with the admin's name.
 */
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAdmin, setAdmin } from "../AdminCredentials";
import { ADMIN_LOGIN_LIMIT, AdminPanel } from "../AdminPanel";
import { FairPlayStore } from "../FairPlayStore";
import { PlayerStore } from "../PlayerStore";

let dir: string;
let file: string;
let server: Server;
let base: string;
let fairPlay: FairPlayStore;
let accounts: PlayerStore;
let onSanction: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "admin-panel-"));
  file = path.join(dir, "admin.json");
  fairPlay = new FairPlayStore(":memory:");
  accounts = new PlayerStore(":memory:");
  onSanction = vi.fn();
  const panel = new AdminPanel({ file, fairPlay, accounts, onSanction });
  server = createServer((req, res) => {
    if (!panel.handle(req, res)) {
      res.writeHead(426);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fairPlay.close();
  accounts.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const post = (route: string, fields: Record<string, string>, cookie = "", origin = base) =>
  fetch(`${base}/admin${route}`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie, Origin: origin },
    body: form(fields),
  });

async function signIn(): Promise<{ cookie: string; csrf: string }> {
  const res = await post("/login", { name: "tarmo", password: "correct horse battery" });
  expect(res.status).toBe(303);
  const setCookie = res.headers.get("set-cookie") ?? "";
  expect(setCookie).toMatch(/HttpOnly; Secure; SameSite=Strict/);
  const cookie = setCookie.split(";")[0];
  const page = await (await fetch(`${base}/admin`, { headers: { Cookie: cookie } })).text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(page)?.[1] ?? "";
  expect(csrf).not.toBe("");
  return { cookie, csrf };
}

describe("admin panel", () => {
  it("is not there without an admin, and leaves other paths to the lobby", async () => {
    expect((await fetch(`${base}/admin`)).status).toBe(404);
    expect((await fetch(`${base}/`)).status).toBe(426);
  });

  it("keeps only a hash of the password, in a file only its owner reads", () => {
    setAdmin(file, "tarmo", "correct horse battery");
    const text = fs.readFileSync(file, "utf8");
    expect(text).not.toContain("correct horse");
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o077).toBe(0);
    expect(checkAdmin(file, "TARMO", "correct horse battery")).toBe("tarmo");
    expect(checkAdmin(file, "tarmo", "wrong password!!")).toBeNull();
    expect(() => setAdmin(file, "short", "too short")).toThrow(/at least/);
  });

  it("signs in, bans with the admin's name and disconnects at once", async () => {
    setAdmin(file, "tarmo", "correct horse battery");
    const { account } = accounts.create();
    const { cookie, csrf } = await signIn();
    const res = await post(
      "/sanction",
      { csrf, accountId: String(account.id), kind: "ban", reason: "Aimbot <script>", days: "7" },
      cookie,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/admin/account?id=${account.id}`);
    expect(fairPlay.activeBan(account.id)).toMatchObject({ reason: "Aimbot <script>", by: "tarmo" });
    expect(onSanction).toHaveBeenCalledOnce();
    const page = await (await fetch(`${base}/admin/account?id=${account.id}`, { headers: { Cookie: cookie } })).text();
    expect(page).toContain("Aimbot &lt;script&gt;");
    expect(page).not.toContain("<script>");
  });

  it("refuses a change without the session's token or from another site", async () => {
    setAdmin(file, "tarmo", "correct horse battery");
    const { account } = accounts.create();
    const { cookie, csrf } = await signIn();
    const fields = { accountId: String(account.id), kind: "ban", reason: "x" };
    await post("/sanction", { ...fields, csrf: "forged" }, cookie);
    expect((await post("/sanction", { ...fields, csrf }, cookie, "https://evil.example")).status).toBe(403);
    expect(fairPlay.activeBan(account.id)).toBeNull();
  });

  it("asks for the page to sign in again without a session", async () => {
    setAdmin(file, "tarmo", "correct horse battery");
    const page = await (await fetch(`${base}/admin`)).text();
    expect(page).toContain('type="password"');
    const res = await fetch(`${base}/admin`);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("makes an address wait after too many wrong passwords", async () => {
    setAdmin(file, "tarmo", "correct horse battery");
    for (let i = 0; i < ADMIN_LOGIN_LIMIT; i++) {
      expect((await post("/login", { name: "tarmo", password: "nope nope nope" })).status).toBe(401);
    }
    expect((await post("/login", { name: "tarmo", password: "correct horse battery" })).status).toBe(429);
  });

  it("ends a removed admin's session", async () => {
    setAdmin(file, "tarmo", "correct horse battery");
    setAdmin(file, "other", "another long password");
    const { cookie } = await signIn();
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    json.admins = json.admins.filter((a: { name: string }) => a.name !== "tarmo");
    fs.writeFileSync(file, JSON.stringify(json));
    const page = await (await fetch(`${base}/admin`, { headers: { Cookie: cookie } })).text();
    expect(page).toContain('type="password"');
  });
});
