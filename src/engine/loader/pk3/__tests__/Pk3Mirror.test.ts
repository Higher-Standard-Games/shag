/**
 * pk3 packages come from the HTTP mirror when it has the origin's copy, and
 * from the origin otherwise: no mirror, a file outside data/, a file the
 * mirror lacks or holds at another size, or a mirror that is down.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPk3, mirrorUrlFor, pk3MirrorBase, resetPk3MirrorForTests } from "../Pk3Mirror";

const MIRROR = "https://mirror.example/washoi/";

type Answer = { status?: number; size?: number; type?: string } | "network_error";

/** A fetch that answers each URL (GET and HEAD alike) from `answers`, and records the calls. */
function fakeFetch(answers: Record<string, Answer>) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const answer = answers[url] ?? { status: 404 };
    if (answer === "network_error") throw new TypeError("Failed to fetch");
    const headers = new Headers({ "content-type": answer.type ?? "application/zip" });
    if (answer.size !== undefined) headers.set("content-length", String(answer.size));
    const status = answer.status ?? 200;
    return new Response(status === 200 && init?.method !== "HEAD" ? `body of ${url}` : null, { status, headers });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

afterEach(() => {
  resetPk3MirrorForTests();
  vi.restoreAllMocks();
});

describe("pk3MirrorBase", () => {
  it("is null when no mirror is configured, and always ends in a slash", () => {
    expect(pk3MirrorBase(undefined)).toBeNull();
    expect(pk3MirrorBase("  ")).toBeNull();
    expect(pk3MirrorBase("https://mirror.example/washoi")).toBe(MIRROR);
    expect(pk3MirrorBase(MIRROR)).toBe(MIRROR);
  });
});

describe("mirrorUrlFor", () => {
  it("maps a pk3 under data/ to the same path on the mirror", () => {
    expect(mirrorUrlFor("data/map_wdm2.pk3", MIRROR)).toBe(`${MIRROR}map_wdm2.pk3`);
    expect(mirrorUrlFor("/data/basewf/x.pk3", MIRROR)).toBe(`${MIRROR}basewf/x.pk3`);
  });

  it("leaves everything else to the origin", () => {
    expect(mirrorUrlFor("games/default/basewsw/tex.pk3", MIRROR)).toBeNull();
    expect(mirrorUrlFor("data/levelshots/wdm2.jpg", MIRROR)).toBeNull();
    expect(mirrorUrlFor("data/../secret.pk3", MIRROR)).toBeNull();
  });
});

describe("fetchPk3", () => {
  it("downloads from the origin alone when there is no mirror", async () => {
    const { impl, calls } = fakeFetch({ "data/a.pk3": { size: 10 } });
    const result = await fetchPk3("data/a.pk3", null, impl);
    expect(result.source).toBe("origin");
    expect(calls).toEqual(["GET data/a.pk3"]);
  });

  it("takes the mirror's copy when it matches the origin's size", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { impl, calls } = fakeFetch({ "data/a.pk3": { size: 10 }, [`${MIRROR}a.pk3`]: { size: 10 } });
    const result = await fetchPk3("data/a.pk3", MIRROR, impl);
    expect(result.source).toBe("mirror");
    expect(await result.response.text()).toBe(`body of ${MIRROR}a.pk3`);
    expect(calls.sort()).toEqual([`GET ${MIRROR}a.pk3`, "HEAD data/a.pk3"]);
  });

  it("takes the mirror's copy when the origin gives no size to compare", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { impl } = fakeFetch({ "data/a.pk3": {}, [`${MIRROR}a.pk3`]: { size: 10 } });
    expect((await fetchPk3("data/a.pk3", MIRROR, impl)).source).toBe("mirror");
  });

  it.each([
    ["the mirror lacks it", { status: 404 } as Answer, "not_on_mirror"],
    ["the mirror's copy is another size", { size: 9 } as Answer, "size_differs"],
    ["the mirror answers with a web page", { size: 10, type: "text/html" } as Answer, "not_on_mirror"],
    ["the mirror is down", "network_error" as Answer, "mirror_error"],
  ])("downloads from the origin when %s", async (_why, mirrorAnswer, miss) => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { impl, calls } = fakeFetch({ "data/a.pk3": { size: 10 }, [`${MIRROR}a.pk3`]: mirrorAnswer });
    const result = await fetchPk3("data/a.pk3", MIRROR, impl);
    expect(result).toMatchObject({ source: "origin", miss });
    expect(await result.response.text()).toBe("body of data/a.pk3");
    expect(calls).toContain("GET data/a.pk3");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not take a file the origin doesn't have, and answers as the origin does", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { impl } = fakeFetch({ [`${MIRROR}gone.pk3`]: { size: 10 } });
    const result = await fetchPk3("data/gone.pk3", MIRROR, impl);
    expect(result).toMatchObject({ source: "origin", miss: "not_on_origin" });
    expect(result.response.status).toBe(404);
    expect(warn).not.toHaveBeenCalled();
  });
});
