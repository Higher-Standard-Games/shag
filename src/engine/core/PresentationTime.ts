export interface PresentationClock {
  nowMs: number;
}

let owner: PresentationClock | null = null;

export function hasPresentationClock(): boolean {
  return owner !== null;
}

/** The document's presentation time; live documents retain their normal wall clock. */
export function presentationNow(): number {
  return owner?.nowMs ?? performance.now();
}

/** An isolated renderer may own its clock until disposal. */
export function ownPresentationClock(clock: PresentationClock): () => void {
  if (owner) throw new Error("Presentation clock already owned");
  owner = clock;
  let released = false;
  return () => {
    if (!released && owner === clock) owner = null;
    released = true;
  };
}
