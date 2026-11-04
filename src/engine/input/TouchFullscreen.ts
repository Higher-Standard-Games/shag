/**
 * Fullscreen and landscape for touch play.
 *
 * A browser enters fullscreen only from the player's tap or click, and locks
 * the orientation only while in fullscreen; an iPhone offers neither for a
 * page. So the request is made from taps the game already asks for (the boot
 * screen's start, the match menu's Resume), and a refusal is quiet: the touch
 * controls ask the player to turn the device instead.
 */

type LockableOrientation = ScreenOrientation & { lock?: (orientation: "landscape") => Promise<void> };

/** Enter fullscreen and lock landscape. Call it from inside a tap's handler. */
export async function enterTouchFullscreen(
  doc: Pick<Document, "fullscreenElement" | "documentElement"> = document,
  orientation: LockableOrientation | undefined = globalThis.screen?.orientation,
): Promise<void> {
  try {
    // requestFullscreen runs before the first await, inside the tap
    if (!doc.fullscreenElement) await doc.documentElement.requestFullscreen?.();
    await orientation?.lock?.("landscape");
  } catch {
    // Refused, or not offered here: the controls show "turn your device" in portrait
  }
}
