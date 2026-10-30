/**
 * Capture the mouse with raw movement: the browser reports the mouse's own
 * counts, without the operating system's pointer acceleration ("Enhance pointer
 * precision" on Windows), so the same hand movement always turns the view the
 * same amount.
 *
 * Browsers without raw movement (Firefox) ignore the option. Where the browser
 * has it but the system does not, the request is refused and the mouse is
 * captured the ordinary way instead. Resolves once captured; rejects only when
 * the ordinary capture fails too. A browser whose capture returns nothing
 * resolves at once and reports the outcome through `pointerlockchange`.
 */
export async function requestRawPointerLock(element: Element): Promise<void> {
  try {
    await element.requestPointerLock({ unadjustedMovement: true });
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "NotSupportedError") throw error;
    await element.requestPointerLock();
  }
}
