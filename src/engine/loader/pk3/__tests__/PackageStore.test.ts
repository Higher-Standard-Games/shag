import { createHash } from "node:crypto";
import JSZip from "jszip";
import { afterEach, expect, it, vi } from "vitest";
import { PackageStore } from "../PackageStore";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function archive(text = "hello") {
  const bytes = await new JSZip().file("hello.txt", text).generateAsync({ type: "arraybuffer" });
  const hash = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
  return { bytes, hash };
}

function disk() {
  const entries = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (key: string | Request) => entries.get(typeof key === "string" ? key : key.url)?.clone()),
    put: vi.fn(async (key: string, response: Response) => {
      entries.set(key, response.clone());
    }),
    delete: vi.fn(async (key: string | Request) => entries.delete(typeof key === "string" ? key : key.url)),
    keys: vi.fn(async () => [...entries.keys()].map((key) => new Request(key))),
  };
  vi.stubGlobal("caches", { open: async () => cache });
  return { cache, entries };
}

it("joins an active background transfer without a second HTTP body and reuses parsed memory", async () => {
  const { bytes, hash } = await archive();
  const store = new PackageStore();
  store.register("data/hello.pk3", hash);
  let finish!: (response: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const background = store.acquire("data/hello.pk3", "hello.pk3", "background");
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const foreground = store.acquire("data/hello.pk3", "hello.pk3");
  expect(foreground).toBe(background);
  finish(new Response(bytes));
  const zip = await foreground;
  expect(await store.acquire("data/hello.pk3", "hello.pk3")).toBe(zip);
  expect(fetch).toHaveBeenCalledOnce();
});

it("promotes queued foreground demand even when background work is paused", async () => {
  const { bytes } = await archive();
  const store = new PackageStore();
  store.setPaused(true);
  const fetch = vi.fn(async () => new Response(bytes));
  vi.stubGlobal("fetch", fetch);
  const pending = store.acquire("data/hello.pk3", "hello.pk3", "background");
  await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
  expect(store.acquire("data/hello.pk3", "hello.pk3")).toBe(pending);
  await pending;
  expect(fetch).toHaveBeenCalledOnce();
});

it("reuses disk across store instances and index timestamps, but invalidates changed content", async () => {
  disk();
  const first = await archive();
  const second = await archive("replacement");
  const fetch = vi.fn(async () => new Response(first.bytes));
  vi.stubGlobal("fetch", fetch);
  const store = new PackageStore();
  store.register("data/hello.pk3", first.hash);
  await store.acquire("data/hello.pk3?pk3v=1", "hello.pk3");
  const reloaded = new PackageStore();
  reloaded.register("data/hello.pk3", first.hash);
  const zip = await reloaded.acquire("data/hello.pk3?pk3v=2", "hello.pk3");
  expect(await zip.file("hello.txt")!.async("string")).toBe("hello");
  expect(fetch).toHaveBeenCalledOnce();
  reloaded.register("data/hello.pk3", second.hash);
  fetch.mockImplementation(async () => new Response(second.bytes));
  expect(await (await reloaded.acquire("data/hello.pk3", "hello.pk3")).file("hello.txt")!.async("string")).toBe(
    "replacement",
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("evicts a corrupt stored body and repairs it from HTTP", async () => {
  const { entries } = disk();
  const { bytes, hash } = await archive();
  entries.set(`http://pk3.local/data/hello.pk3?shag-content=${hash}`, new Response("corrupt"));
  const fetch = vi.fn(async () => new Response(bytes));
  vi.stubGlobal("fetch", fetch);
  const store = new PackageStore();
  store.register("data/hello.pk3", hash);
  await store.acquire("data/hello.pk3", "hello.pk3");
  expect(fetch).toHaveBeenCalledOnce();
});

it("still plays with denied storage, and does not persist legacy unversioned packages", async () => {
  const { bytes, hash } = await archive();
  const open = vi.fn(async () => {
    throw new Error("denied");
  });
  vi.stubGlobal("caches", { open });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(bytes)),
  );
  const store = new PackageStore();
  await store.acquire("data/legacy.pk3", "legacy.pk3");
  expect(open).not.toHaveBeenCalled();
  store.register("data/hello.pk3", hash);
  await store.acquire("data/hello.pk3", "hello.pk3");
});

it("drops obsolete queued background demand without cancelling a foreground consumer", async () => {
  const { bytes } = await archive();
  const store = new PackageStore();
  store.setPaused(true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(bytes)),
  );
  const obsolete = store.acquire("data/old.pk3", "old.pk3", "background");
  const rejection = expect(obsolete).rejects.toThrow("superseded");
  store.dropQueuedBackground();
  await rejection;
  expect(store.pendingCount).toBe(0);
  const needed = store.acquire("data/new.pk3", "new.pk3", "background");
  const foreground = store.acquire("data/new.pk3", "new.pk3");
  store.dropQueuedBackground();
  await needed;
  await foreground;
  expect(store.pendingCount).toBe(0);
});

it("reacquires a cancelled key without letting its old job steal a saturated slot", async () => {
  const { bytes } = await archive();
  const store = new PackageStore();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetch = vi.fn(async (url: string) => {
    if (url.includes("block-")) await held;
    return new Response(bytes);
  });
  vi.stubGlobal("fetch", fetch);
  const first = store.acquire("data/block-a.pk3", "block-a.pk3");
  const second = store.acquire("data/block-b.pk3", "block-b.pk3");
  let prematureRequests = 0;
  let completed = false;
  let replacement = Promise.resolve();
  try {
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    store.setPaused(true);
    const obsolete = store.acquire("data/retry.pk3", "retry.pk3", "background");
    const rejected = expect(obsolete).rejects.toThrow("superseded");
    store.dropQueuedBackground();
    replacement = store.acquire("data/retry.pk3", "retry.pk3").then(() => {
      completed = true;
    });
    await rejected;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    prematureRequests = fetch.mock.calls.length;
  } finally {
    release();
    await Promise.all([first, second]);
  }
  expect(prematureRequests).toBe(2);
  await vi.waitFor(() => expect(completed).toBe(true));
  await replacement;
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(store.pendingCount).toBe(0);
});

it("retains older entries that fit after evicting a large cached package", async () => {
  const { entries } = disk();
  const { bytes, hash } = await archive();
  const older = "http://pk3.local/data/older.pk3?shag-content=old";
  const newer = "http://pk3.local/data/newer.pk3?shag-content=new";
  entries.set(older, new Response("a", { headers: { "content-length": "1" } }));
  entries.set(newer, new Response("b", { headers: { "content-length": String(512 * 1024 * 1024 - 1) } }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(bytes)),
  );
  const store = new PackageStore();
  store.register("data/hello.pk3", hash);
  await store.acquire("data/hello.pk3", "hello.pk3");
  expect(entries.has(newer)).toBe(false);
  expect(entries.has(older)).toBe(true);
  expect(entries.has(`http://pk3.local/data/hello.pk3?shag-content=${hash}`)).toBe(true);
});
