/**
 * Copy text to the system clipboard. Resolves false when the browser refuses.
 *
 * The Clipboard API comes first. Where a frame's permissions policy blocks it
 * (Chromium inside an itch.io game frame), copying a selection with
 * `execCommand("copy")` still works during a click.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copySelection(text);
  }
}

function copySelection(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  area.style.pointerEvents = "none";
  document.body.append(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  focused?.focus();
  return copied;
}
