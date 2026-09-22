/**
 * The bot secret shared by the lobby and the bot server: where it comes from,
 * and that every process on the machine ends up with the same one.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadBotSecret, resolveDataDir, secretMatches } from "../ServerData";

let dataDir: string;
const savedEnv = { BOT_SECRET: process.env.BOT_SECRET, SERVER_DATA_DIR: process.env.SERVER_DATA_DIR };

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shag-data-"));
  delete process.env.BOT_SECRET;
  delete process.env.SERVER_DATA_DIR;
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("loadBotSecret", () => {
  it("creates a secret file once and hands every later caller the same secret", () => {
    const first = loadBotSecret(dataDir);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readFileSync(path.join(dataDir, "bot-secret"), "utf8")).toBe(first);
    expect(loadBotSecret(dataDir)).toBe(first);
  });

  it("reads a secret another process already wrote", () => {
    fs.writeFileSync(path.join(dataDir, "bot-secret"), "written-by-the-lobby\n");
    expect(loadBotSecret(dataDir)).toBe("written-by-the-lobby");
  });

  it("prefers BOT_SECRET and leaves the data directory alone", () => {
    process.env.BOT_SECRET = "from-the-environment";
    expect(loadBotSecret(dataDir)).toBe("from-the-environment");
    expect(fs.existsSync(path.join(dataDir, "bot-secret"))).toBe(false);
  });

  it("creates the data directory when it is missing", () => {
    const nested = path.join(dataDir, "fresh", "dir");
    expect(loadBotSecret(nested)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("leaves no temporary files behind", () => {
    loadBotSecret(dataDir);
    loadBotSecret(dataDir);
    expect(fs.readdirSync(dataDir)).toEqual(["bot-secret"]);
  });
});

describe("resolveDataDir", () => {
  it("takes an explicit directory first, then SERVER_DATA_DIR, then server-data/", () => {
    process.env.SERVER_DATA_DIR = path.join(dataDir, "env");
    expect(resolveDataDir(path.join(dataDir, "flag"))).toBe(path.join(dataDir, "flag"));
    expect(resolveDataDir()).toBe(path.join(dataDir, "env"));
    delete process.env.SERVER_DATA_DIR;
    expect(resolveDataDir()).toBe(path.join(process.cwd(), "server-data"));
  });
});

describe("secretMatches", () => {
  it("accepts only the exact secret", () => {
    expect(secretMatches("s3cret", "s3cret")).toBe(true);
    expect(secretMatches("s3cret", "s3cre")).toBe(false);
    expect(secretMatches("s3cret", "S3CRET")).toBe(false);
  });

  it("rejects anything when no secret is configured, and anything that isn't a string", () => {
    expect(secretMatches(undefined, "s3cret")).toBe(false);
    expect(secretMatches("", "")).toBe(false);
    expect(secretMatches("s3cret", undefined)).toBe(false);
    expect(secretMatches("s3cret", ["s3cret"])).toBe(false);
    expect(secretMatches("s3cret", "")).toBe(false);
  });
});
