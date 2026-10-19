import JSZip from "jszip";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PK3Loader } from "../PK3Loader";

let loader: PK3Loader;
let bytes: Uint8Array;
beforeEach(async () => {
  loader = PK3Loader.createTransient();
  bytes = await new JSZip().file("probe.txt", "base").generateAsync({ type: "uint8array" });
});
afterEach(() => {
  loader.unloadAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("shares body reads, parsing and indexing across filename/URL consumers and reuses a mounted archive", async () => {
  const fetch = vi.fn(async () => new Response(Uint8Array.from(bytes)));
  vi.stubGlobal("fetch", fetch);
  const parse = vi.spyOn(JSZip, "loadAsync");
  await Promise.all([
    ...Array.from({ length: 8 }, () => loader.ensurePK3("probe.pk3")),
    loader.ensurePK3FromUrl("./data/probe.pk3"),
  ]);
  await loader.ensurePK3("probe.pk3");
  expect(fetch).toHaveBeenCalledOnce();
  expect(parse).toHaveBeenCalledOnce();
  expect(loader.getPackageInfo()).toHaveLength(1);
  expect(new TextDecoder().decode((await loader.getFile("probe.txt"))!)).toBe("base");
});

it("keeps explicit refresh and revision URLs able to replace a mounted archive", async () => {
  const replacement = await new JSZip().file("probe.txt", "updated").generateAsync({ type: "uint8array" });
  const fetch = vi.fn(async () => new Response(Uint8Array.from(bytes)));
  vi.stubGlobal("fetch", fetch);
  await loader.ensurePK3("probe.pk3");
  bytes = replacement;
  await loader.loadPK3("probe.pk3");
  await loader.ensurePK3("probe.pk3");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(new TextDecoder().decode((await loader.getFile("probe.txt"))!)).toBe("updated");
  await loader.ensurePK3FromUrl("data/probe.pk3?v=2");
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(loader.getPackageInfo()[0].filename).toBe("probe.pk3");
});

it("reuses an explicitly ingested local archive for filename consumers", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await loader.processPK3ArrayBuffer("probe.pk3", Uint8Array.from(bytes).buffer);
  await loader.ensurePK3("probe.pk3");
  expect(fetch).not.toHaveBeenCalled();
});

it("releases failed ensures for retry and shares configured search-path fallback", async () => {
  loader.configure({ basePath: "missing/", additionalPaths: ["data/"] });
  let available = false;
  const fetch = vi.fn(async (url: string) =>
    available && url.startsWith("data/") ? new Response(Uint8Array.from(bytes)) : new Response(null, { status: 404 }),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(loader.ensurePK3("probe.pk3")).rejects.toThrow("404");
  available = true;
  fetch.mockClear();
  await Promise.all([loader.ensurePK3("probe.pk3"), loader.ensurePK3("probe.pk3")]);
  await loader.ensurePK3("probe.pk3");
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(["missing/probe.pk3", "data/probe.pk3"]);
});

it("does not remount a response arriving after unload or reuse its pending promise", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockImplementation(async () => new Response(Uint8Array.from(bytes))),
  );
  const pending = loader.ensurePK3("probe.pk3");
  const rejected = expect(pending).rejects.toThrow("superseded or unloaded");
  loader.unloadAll();
  await loader.ensurePK3("probe.pk3");
  finish(new Response(Uint8Array.from(bytes)));
  await rejected;
  expect(loader.getPackageInfo()).toHaveLength(1);
});

it("does not let an older ensure overwrite an explicit refresh", async () => {
  let finish!: (response: Response) => void;
  const updated = await new JSZip().file("probe.txt", "updated").generateAsync({ type: "uint8array" });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockImplementation(async () => new Response(Uint8Array.from(updated))),
  );
  const pending = loader.ensurePK3("probe.pk3");
  const rejected = expect(pending).rejects.toThrow("superseded");
  await loader.loadPK3("probe.pk3");
  finish(new Response(Uint8Array.from(bytes)));
  await rejected;
  expect(new TextDecoder().decode((await loader.getFile("probe.txt"))!)).toBe("updated");
});

it("does not merge sources with the same basename and preserves alphabetical overrides", async () => {
  const fetch = vi.fn(async () => new Response(Uint8Array.from(bytes)));
  vi.stubGlobal("fetch", fetch);
  await loader.ensurePK3FromUrl("https://a.invalid/probe.pk3");
  await loader.ensurePK3FromUrl("https://b.invalid/probe.pk3");
  const updated = await new JSZip().file("probe.txt", "override").generateAsync({ type: "uint8array" });
  bytes = updated;
  await loader.ensurePK3("z_override.pk3");
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(new TextDecoder().decode((await loader.getFile("probe.txt"))!)).toBe("override");
});
