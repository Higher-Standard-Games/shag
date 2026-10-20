import { onChunkLoadError } from "../core/AsyncErrors";
import { PopupSystem } from "../core/PopupSystem";

let shown = false;

/**
 * A chunk the page asked for is gone, almost always because a new version was
 * deployed while this tab stayed open. Offer one reload instead of running on
 * with missing pieces (kill feed, banners, effects). Shown once per page.
 */
function showStaleBuildNotice(): void {
  if (shown) return;
  shown = true;
  PopupSystem.show({
    id: "stale-build",
    title: "New version available",
    content: "A new version was released while this tab was open. Reload to get it.",
    position: "top",
    buttons: [
      { label: "Later", action: "close", style: "secondary" },
      { label: "Reload", action: "reload", style: "primary" },
    ],
    onButton: (action) => {
      if (action === "reload") window.location.reload();
    },
  });
}

/** Failed lazy chunks, ours (`logRejection`) and Vite's (`vite:preloadError`), show the notice. */
export function installStaleBuildNotice(): void {
  onChunkLoadError(showStaleBuildNotice);
  // Not prevented: the import still rejects, so its own catch logs where it failed
  window.addEventListener("vite:preloadError", showStaleBuildNotice);
}
