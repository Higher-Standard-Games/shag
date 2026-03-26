/**
 * KanjiWatermark — Decorative background characters
 *
 * Large Japanese kanji at very low opacity behind the panel content.
 * Creates an atmospheric "holographic terminal" feel.
 */

const KANJI_SETS = [
  { left: "闘", right: "魂" }, // fight, soul
  { left: "速", right: "力" }, // speed, power
  { left: "技", right: "道" }, // technique, way
];

/**
 * Create kanji watermark elements for a GamePanel.
 * Returns array of elements for cleanup.
 */
export function createKanjiWatermarks(container: HTMLElement): HTMLElement[] {
  // Pick a random set
  const set = KANJI_SETS[Math.floor(Math.random() * KANJI_SETS.length)];
  const elements: HTMLElement[] = [];

  // Left kanji
  const left = document.createElement("span");
  left.className = "game-panel__kanji game-panel__kanji--left";
  left.textContent = set.left;
  left.setAttribute("aria-hidden", "true");
  container.appendChild(left);
  elements.push(left);

  // Right kanji
  const right = document.createElement("span");
  right.className = "game-panel__kanji game-panel__kanji--right";
  right.textContent = set.right;
  right.setAttribute("aria-hidden", "true");
  container.appendChild(right);
  elements.push(right);

  return elements;
}
