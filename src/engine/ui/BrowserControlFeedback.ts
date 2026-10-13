import { createRaisedKey, injectRaisedKeyStyles } from "./components/RaisedKey";

/** One dismissible notice, with no global listeners or timers to retain. */
export function showBrowserControlFailure(message: string, control: "pointer" | "fullscreen" = "fullscreen"): void {
  injectRaisedKeyStyles();
  document.getElementById("browser-control-feedback")?.remove();
  const notice = document.createElement("div");
  notice.id = "browser-control-feedback";
  notice.dataset.control = control;
  notice.setAttribute("role", "alert");
  notice.style.cssText =
    "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:16px;max-width:90vw;padding:12px 18px;background:#27203d;color:#fff7dc;font:600 16px/1.4 sans-serif;box-shadow:0 4px 20px #0008";
  const text = document.createElement("span");
  text.textContent = message;
  const dismiss = createRaisedKey({ label: "Dismiss", variants: ["sm", "cream", "inline"] });
  dismiss.onclick = () => notice.remove();
  notice.append(text, dismiss);
  document.body.append(notice);
}

export function clearBrowserControlFailure(control: "pointer" | "fullscreen"): void {
  const notice = document.getElementById("browser-control-feedback");
  if (notice?.dataset.control === control) notice.remove();
}

/** Supports promise-returning and legacy void browser APIs, and Electron. */
export async function requestBrowserFullscreen(
  next?: boolean,
  failed: (message: string) => void = showBrowserControlFailure,
): Promise<boolean> {
  try {
    if (next === undefined) {
      next = window.electronAPI?.window?.isFullscreen
        ? !(await window.electronAPI.window.isFullscreen())
        : !document.fullscreenElement;
    }
    if (window.electronAPI?.window?.setFullscreen) await window.electronAPI.window.setFullscreen(next);
    else if (next) {
      if (typeof document.documentElement.requestFullscreen !== "function") {
        failed("Fullscreen is not available in this browser.");
        return false;
      }
      await document.documentElement.requestFullscreen();
    } else if (document.fullscreenElement) await document.exitFullscreen();
    clearBrowserControlFailure("fullscreen");
    return true;
  } catch {
    failed("Your browser could not change fullscreen. Try again from the Fullscreen setting or with Alt+Enter.");
    return false;
  }
}
