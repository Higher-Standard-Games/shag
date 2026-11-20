// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { installHostedPublicUrls, resetPublicUrlsForTests } from "../../../core/PublicUrls";
import { PK3Index } from "../PK3Index";

const INDEX = {
  version: 2,
  listChecksum: "planted",
  lastUpdated: 1,
  files: { "maps/x.bsp": "evil.pk3" },
  shaders: {},
  maps: {},
  packages: [{ pk3: "evil.pk3", path: "https://evil.example/evil.pk3", fileCount: 1, sha256: "b".repeat(64) }],
};

afterEach(() => {
  resetPublicUrlsForTests();
  localStorage.clear();
  PK3Index.getInstance().clear();
});

it("neither reads nor writes the package index in browser storage in a hosted build", () => {
  const index = PK3Index.getInstance() as unknown as {
    loadFromStorage(): void;
    saveToStorage(): void;
    index: unknown;
  };
  localStorage.setItem("pk3_index", JSON.stringify(INDEX));
  installHostedPublicUrls({ dataBase: "https://eu.washoi.net/data", buildBase: "./" });
  index.index = null;
  index.loadFromStorage();
  expect(index.index).toBeNull();

  index.index = { ...INDEX, listChecksum: "fresh" };
  index.saveToStorage();
  expect(JSON.parse(localStorage.getItem("pk3_index") ?? "{}").listChecksum).toBe("planted");
});

it("keeps using browser storage for a build served from its own site", () => {
  const index = PK3Index.getInstance() as unknown as {
    loadFromStorage(): void;
    index: { listChecksum?: string } | null;
  };
  localStorage.setItem("pk3_index", JSON.stringify(INDEX));
  index.index = null;
  index.loadFromStorage();
  const loaded = index.index as { listChecksum?: string } | null;
  expect(loaded?.listChecksum).toBe("planted");
});
