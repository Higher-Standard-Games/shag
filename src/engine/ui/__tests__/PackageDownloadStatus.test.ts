// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { PackageDownload } from "../../loader/pk3/PackageDownload";
import { PackageDownloadStatus } from "../PackageDownloadStatus";

afterEach(() => {
  for (const download of PackageDownload.getActive()) download.finish();
  document.body.replaceChildren();
  vi.useRealTimers();
});

it("shows transfers already running, unknown sizes and concurrent completion; cleans its timer", () => {
  vi.useFakeTimers();
  const a = new PackageDownload("washoi_textures.pk3");
  a.response(new Response(null, { headers: { "content-length": "100000000" } }));
  a.update(25_000_000);
  const view = new PackageDownloadStatus();
  document.body.append(view.root);
  expect(view.root.textContent).toContain("washoi_textures.pk3");
  expect(view.root.textContent).toContain("25.0 MB / 100.0 MB");
  expect(view.root.textContent).toContain("MB/s");
  expect(view.root.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("25");
  const b = new PackageDownload("washoi_sounds.pk3");
  b.response(new Response(null));
  b.update(2_000_000);
  a.finish();
  vi.advanceTimersByTime(250);
  expect(view.root.textContent).not.toContain("washoi_textures.pk3");
  expect(view.root.textContent).toContain("2.0 MB received");
  expect(view.root.querySelector("[role=progressbar]")?.hasAttribute("aria-valuenow")).toBe(false);
  const unknownBar = view.root.querySelector("[role=progressbar]");
  b.update(2_500_000);
  vi.advanceTimersByTime(250);
  expect(view.root.querySelector("[role=progressbar]")).toBe(unknownBar);
  b.finish();
  vi.advanceTimersByTime(250);
  expect(view.root.hidden).toBe(true);
  view.destroy();
  expect(vi.getTimerCount()).toBe(0);
});

it("limits visible packages and promotes the next transfer when one finishes", () => {
  vi.useFakeTimers();
  const downloads = [1, 2, 3, 4].map((id) => new PackageDownload(`package${id}.pk3`));
  const view = new PackageDownloadStatus();
  expect(view.root.querySelectorAll("[role=progressbar]")).toHaveLength(3);
  expect(view.root.textContent).toContain("+ 1 more package downloading");
  expect(view.root.textContent).not.toContain("package4.pk3");
  downloads[0].finish();
  vi.advanceTimersByTime(250);
  expect(view.root.textContent).toContain("package4.pk3");
  expect(view.root.querySelector<HTMLElement>(".package-downloads__more")?.hidden).toBe(true);
  view.destroy();
  expect(vi.getTimerCount()).toBe(0);
});
