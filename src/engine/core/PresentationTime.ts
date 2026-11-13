export interface PresentationClock {
  nowMs: number;
}

/** A pending callback on the presentation clock. */
export interface PresentationTimer {
  cancel(): void;
}

interface OwnedTimer {
  id: number;
  dueMs: number;
  everyMs: number | null;
  run: () => void;
}

let owner: PresentationClock | null = null;
let owned: OwnedTimer[] = [];
let nextTimerId = 1;

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
  owned = [];
  let released = false;
  return () => {
    if (!released && owner === clock) {
      owner = null;
      owned = [];
    }
    released = true;
  };
}

function schedule(run: () => void, ms: number, repeat: boolean): PresentationTimer {
  const delay = Math.max(0, Number.isFinite(ms) ? ms : 0);
  if (!owner) {
    const id = repeat ? globalThis.setInterval(run, delay) : globalThis.setTimeout(run, delay);
    return { cancel: () => (repeat ? globalThis.clearInterval(id) : globalThis.clearTimeout(id)) };
  }
  const timer: OwnedTimer = { id: nextTimerId++, dueMs: owner.nowMs + delay, everyMs: repeat ? delay : null, run };
  owned.push(timer);
  const timers = owned;
  return {
    cancel: () => {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    },
  };
}

/**
 * A timeout on presentation time: the wall clock in a live document, and the
 * owner's clock while one owns it, where it fires from `runPresentationTimers`.
 */
export function presentationTimeout(run: () => void, ms: number): PresentationTimer {
  return schedule(run, ms, false);
}

/** An interval on presentation time, as `presentationTimeout`. */
export function presentationInterval(run: () => void, ms: number): PresentationTimer {
  return schedule(run, ms, true);
}

/**
 * Run the owned clock's timers that are due by its current time, earliest
 * first, each at its own due time. Called by the owner after it moves the clock.
 */
export function runPresentationTimers(): void {
  const clock = owner;
  if (!clock) return;
  const now = clock.nowMs;
  for (let guard = 0; guard < 100_000; guard++) {
    let next: OwnedTimer | null = null;
    for (const timer of owned) {
      if (
        timer.dueMs <= now &&
        (!next || timer.dueMs < next.dueMs || (timer.dueMs === next.dueMs && timer.id < next.id))
      )
        next = timer;
    }
    if (!next) return;
    if (next.everyMs === null) owned.splice(owned.indexOf(next), 1);
    else next.dueMs += Math.max(1, next.everyMs);
    // A callback reads the time it was due at, not the frame that ran it
    clock.nowMs = next.dueMs - (next.everyMs === null ? 0 : Math.max(1, next.everyMs));
    try {
      next.run();
    } finally {
      clock.nowMs = now;
    }
  }
  throw new Error("Presentation timers did not settle");
}
