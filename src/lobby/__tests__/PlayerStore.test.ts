/**
 * Player accounts: creation, logging back in with a key, renaming, and what
 * ends up on disk.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatKey } from "../PlayerIdentity";
import { PlayerStore } from "../PlayerStore";

const stores: PlayerStore[] = [];
const dirs: string[] = [];

function memoryStore(isReserved?: (name: string) => boolean): PlayerStore {
  const store = new PlayerStore(":memory:", isReserved);
  stores.push(store);
  return store;
}

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shag-players-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("PlayerStore accounts", () => {
  it("creates an account named Player_<number> with a key that logs back in", () => {
    const store = memoryStore();
    const { account, key } = store.create();
    expect(account.name).toMatch(/^Player_\d{4}$/);
    expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{24}$/);
    expect(store.findByKey(key)).toEqual(account);
  });

  it("finds the account from the key however it was pasted", () => {
    const store = memoryStore();
    const { account, key } = store.create();
    expect(store.findByKey(formatKey(key).toLowerCase())).toEqual(account);
  });

  it("finds nothing for an unknown key or something that isn't a key", () => {
    const store = memoryStore();
    store.create();
    expect(store.findByKey("0123456789ABCDEFGHJKMNPQ")).toBeNull();
    expect(store.findByKey("not a key")).toBeNull();
  });

  it("gives every new account its own name and key, retrying names already taken", () => {
    const store = memoryStore();
    // 300 draws from 9000 four-digit numbers collide a few times, so retries run
    const created = Array.from({ length: 300 }, () => store.create());
    expect(new Set(created.map((c) => c.account.name.toLowerCase())).size).toBe(300);
    expect(new Set(created.map((c) => c.key)).size).toBe(300);
    expect(new Set(created.map((c) => c.account.id)).size).toBe(300);
  });
});

describe("PlayerStore renames", () => {
  it("keeps application reservations local to each store", () => {
    const reserved = memoryStore((name) => /^gyoza(?:_\d+)?$/i.test(name));
    const neutral = memoryStore();
    const first = reserved.create().account;
    const second = neutral.create().account;
    expect(reserved.rename(first.id, "Gyoza_3")).toEqual({ ok: false, code: "name_reserved" });
    expect(neutral.rename(second.id, "Gyoza_3").ok).toBe(true);
  });
  it("renames, and the key then opens the account under its new name", () => {
    const store = memoryStore();
    const { account, key } = store.create();
    expect(store.rename(account.id, "Sundflux")).toEqual({ ok: true, account: { id: account.id, name: "Sundflux" } });
    expect(store.findByKey(key)).toEqual({ id: account.id, name: "Sundflux" });
  });

  it("refuses a name the chat filter would catch, and shows one already taken as a silly name", () => {
    const store = memoryStore();
    const { account, key } = store.create();
    expect(store.rename(account.id, "Shit_Head")).toEqual({ ok: false, code: "name_offensive" });
    const db = store as unknown as { updateName: { run(...args: unknown[]): void } };
    db.updateName.run("nigger", "nigger", account.id);
    expect(store.findByKey(key)?.name).toMatch(/^[A-Z][a-z]+_[A-Z][a-z]+$/);
    expect(store.rename(account.id, "Sundflux")).toEqual({ ok: true, account: { id: account.id, name: "Sundflux" } });
  });

  it("refuses a name another account has, in any capitals", () => {
    const store = memoryStore();
    const first = store.create().account;
    const second = store.create().account;
    store.rename(first.id, "Sundflux");
    expect(store.rename(second.id, "SUNDFLUX")).toEqual({ ok: false, code: "name_taken" });
  });

  it("refuses another account's default name", () => {
    const store = memoryStore();
    const first = store.create().account;
    const second = store.create().account;
    expect(store.rename(second.id, first.name)).toEqual({ ok: false, code: "name_reserved" });
  });

  it("refuses names that break the rules", () => {
    const store = memoryStore();
    const { account } = store.create();
    expect(store.rename(account.id, "a")).toEqual({ ok: false, code: "name_invalid" });
    expect(store.rename(account.id, "Player_42")).toEqual({ ok: false, code: "name_reserved" });
  });

  it("lets you change only the capitals of your own name, even a default one", () => {
    const store = memoryStore();
    const { account } = store.create();
    const lower = account.name.toLowerCase();
    expect(store.rename(account.id, lower)).toEqual({ ok: true, account: { id: account.id, name: lower } });
    store.rename(account.id, "Sundflux");
    expect(store.rename(account.id, "SundFlux")).toMatchObject({ ok: true });
  });

  it("frees the old name for someone else", () => {
    const store = memoryStore();
    const first = store.create().account;
    const second = store.create().account;
    store.rename(first.id, "Alpha");
    store.rename(first.id, "Beta");
    expect(store.rename(second.id, "Alpha")).toMatchObject({ ok: true });
  });

  it("lets only one of two stores on the same file take a name", () => {
    const file = path.join(tempDir(), "players.db");
    const a = new PlayerStore(file);
    const b = new PlayerStore(file);
    stores.push(a, b);
    const first = a.create().account;
    const second = b.create().account;
    expect(a.rename(first.id, "Contested")).toMatchObject({ ok: true });
    expect(b.rename(second.id, "Contested")).toEqual({ ok: false, code: "name_taken" });
  });

  it("throws for an account that doesn't exist", () => {
    expect(() => memoryStore().rename(999, "Nobody")).toThrow(/No player account/);
  });
});

describe("PlayerStore deletion", () => {
  it("deletes only with the account's own key, and the key opens nothing afterwards", () => {
    const store = memoryStore();
    const me = store.create();
    const other = store.create();
    expect(store.deleteAccount(me.account.id, other.key)).toBe(false);
    expect(store.deleteAccount(me.account.id, "not a key")).toBe(false);
    expect(store.findByKey(me.key)).toEqual(me.account);

    expect(store.deleteAccount(me.account.id, formatKey(me.key))).toBe(true);
    expect(store.findByKey(me.key)).toBeNull();
    expect(store.findByKey(other.key)).toEqual(other.account);
    expect(store.deletedAccountIds()).toEqual(new Set([me.account.id]));
  });

  it("frees the name, and many deleted accounts can share the deleted name", () => {
    const store = memoryStore();
    const first = store.create();
    const second = store.create();
    const third = store.create();
    store.rename(first.account.id, "Sundflux");
    store.deleteAccount(first.account.id, first.key);
    store.deleteAccount(second.account.id, second.key);
    expect(store.rename(third.account.id, "Sundflux")).toEqual({
      ok: true,
      account: { id: third.account.id, name: "Sundflux" },
    });
    expect(store.deletedAccountIds()).toEqual(new Set([first.account.id, second.account.id]));
    expect(store.rename(third.account.id, "[deleted account]")).toEqual({ ok: false, code: "name_invalid" });
  });
});

describe("PlayerStore on disk", () => {
  it("keeps accounts across restarts", () => {
    const dir = tempDir();
    const before = PlayerStore.open(dir);
    const { account, key } = before.create();
    before.rename(account.id, "Survivor");
    before.close();

    const after = PlayerStore.open(dir);
    stores.push(after);
    expect(after.findByKey(key)).toEqual({ id: account.id, name: "Survivor" });
  });

  it("never writes the key itself", () => {
    const dir = tempDir();
    const store = PlayerStore.open(dir);
    const { key } = store.create();
    store.close();
    const onDisk = fs
      .readdirSync(dir)
      .map((f) => fs.readFileSync(path.join(dir, f)).toString("latin1"))
      .join("");
    expect(onDisk).not.toContain(key);
  });
});
