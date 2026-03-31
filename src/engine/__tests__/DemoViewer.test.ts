/**
 * DemoViewer tests — In-browser demo playback controller
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DemoViewer, type DemoViewerState } from '../../games/fps/client/DemoViewer';

// ─── Mock DemoReader ─────────────────────────────────────────────

const mockHeader = {
  version: 1,
  map: 'wdm2',
  gametype: 'duel',
  tickRate: 60,
  snapshotRate: 20,
  startTime: Date.now(),
  players: [
    { playerId: 'p1', name: 'Alice', team: '' },
    { playerId: 'p2', name: 'Bob', team: '' },
  ],
};

const mockIndex = {
  frameCount: 100,
  entries: Array.from({ length: 100 }, (_, i) => ({
    tick: i * 3,  // 60Hz / 20Hz = 3 ticks per snapshot
    offset: 100 + i * 50,
  })),
  durationMs: 5000,
  indexOffset: 5100,
};

const mockFrame = (tick: number) => ({
  tick,
  state: {
    tick,
    entities: new Map(),
    players: new Map(),
  },
});

vi.mock('../../shared/demo/DemoReader', () => ({
  DemoReader: {
    fromFile: vi.fn(async () => ({
      readHeader: () => mockHeader,
      readIndex: () => mockIndex,
      readFrame: (idx: number) => mockFrame(mockIndex.entries[idx]?.tick ?? 0),
      findFrameByTick: (tick: number) => {
        for (let i = 0; i < mockIndex.entries.length; i++) {
          if (mockIndex.entries[i].tick >= tick) return i;
        }
        return mockIndex.entries.length - 1;
      },
      getSummary: () => 'wdm2 (duel) — 5.0s, 100 frames — Players: Alice, Bob',
    })),
  },
}));

// ─── Tests ───────────────────────────────────────────────────────

describe('DemoViewer', () => {
  let viewer: DemoViewer;

  beforeEach(() => {
    viewer = new DemoViewer();
  });

  // ── Loading ───────────────────────────────────────────────────

  it('starts in idle state', () => {
    expect(viewer.getState()).toBe('idle');
    expect(viewer.isLoaded()).toBe(false);
  });

  it('loads a demo file', async () => {
    await viewer.load(new Uint8Array(10));
    expect(viewer.isLoaded()).toBe(true);
    expect(viewer.getState()).toBe('loaded');
  });

  it('exposes header after loading', async () => {
    await viewer.load(new Uint8Array(10));
    expect(viewer.getHeader()).toEqual(mockHeader);
  });

  it('reports total frames after loading', async () => {
    await viewer.load(new Uint8Array(10));
    expect(viewer.getTotalFrames()).toBe(100);
  });

  // ── Playback ──────────────────────────────────────────────────

  it('transitions to playing on play()', async () => {
    await viewer.load(new Uint8Array(10));
    viewer.play();
    expect(viewer.getState()).toBe('playing');
  });

  it('pauses playback', async () => {
    await viewer.load(new Uint8Array(10));
    viewer.play();
    viewer.pause();
    expect(viewer.getState()).toBe('paused');
  });

  it('toggles play/pause', async () => {
    await viewer.load(new Uint8Array(10));
    viewer.togglePlayPause();
    expect(viewer.getState()).toBe('playing');
    viewer.togglePlayPause();
    expect(viewer.getState()).toBe('paused');
  });

  it('advances frames at snapshot rate', async () => {
    await viewer.load(new Uint8Array(10));
    viewer.play();

    // Snapshot rate = 20Hz → frame interval = 50ms
    viewer.update(50); // Should advance 1 frame
    expect(viewer.getCurrentFrame()).toBe(1);
  });

  it('advances multiple frames when enough time passes', async () => {
    await viewer.load(new Uint8Array(10));
    viewer.play();

    viewer.update(150); // 150ms → 3 frames at 20Hz
    expect(viewer.getCurrentFrame()).toBe(3);
  });

  it('ends at last frame', async () => {
    await viewer.load(new Uint8Array(10));
    viewer.play();

    // Jump almost to end, then update past it
    viewer.seekToFrame(98);
    viewer.play();
    viewer.update(200); // Should trigger 'ended'
    expect(viewer.getState()).toBe('ended');
    expect(viewer.getCurrentFrame()).toBe(99); // Last frame (0-based)
  });

  it('does not advance when paused', async () => {
    await viewer.load(new Uint8Array(10));
    viewer.play();
    viewer.pause();

    viewer.update(100);
    expect(viewer.getCurrentFrame()).toBe(0);
  });

  // ── Speed ─────────────────────────────────────────────────────

  it('applies speed multiplier', async () => {
    await viewer.load(new Uint8Array(10));
    viewer.setSpeed(2.0);
    viewer.play();

    viewer.update(50); // 50ms * 2x = 100ms effective → 2 frames at 20Hz
    expect(viewer.getCurrentFrame()).toBe(2);
  });

  it('cycles through speed options', async () => {
    await viewer.load(new Uint8Array(10));
    expect(viewer.getSpeed()).toBe(1.0);

    viewer.cycleSpeed(); // → 2.0
    expect(viewer.getSpeed()).toBe(2.0);

    viewer.cycleSpeed(); // → 4.0
    expect(viewer.getSpeed()).toBe(4.0);

    viewer.cycleSpeed(); // → 0.25 (wraps)
    expect(viewer.getSpeed()).toBe(0.25);
  });

  // ── Seeking ───────────────────────────────────────────────────

  it('seeks to specific frame', async () => {
    await viewer.load(new Uint8Array(10));
    viewer.seekToFrame(50);
    expect(viewer.getCurrentFrame()).toBe(50);
  });

  it('clamps seek to valid range', async () => {
    await viewer.load(new Uint8Array(10));
    viewer.seekToFrame(-5);
    expect(viewer.getCurrentFrame()).toBe(0);

    viewer.seekToFrame(500);
    expect(viewer.getCurrentFrame()).toBe(99);
  });

  it('seeks by progress (0.0 – 1.0)', async () => {
    await viewer.load(new Uint8Array(10));
    viewer.seekToProgress(0.5);
    // 0.5 * 99 = 50 (rounded)
    expect(viewer.getCurrentFrame()).toBe(50);
  });

  it('seeks to start and end', async () => {
    await viewer.load(new Uint8Array(10));
    viewer.seekToProgress(1.0);
    expect(viewer.getCurrentFrame()).toBe(99);

    viewer.seekToProgress(0.0);
    expect(viewer.getCurrentFrame()).toBe(0);
  });

  it('seeking from ended state transitions to paused', async () => {
    await viewer.load(new Uint8Array(10));
    viewer.play();
    viewer.seekToFrame(98);
    viewer.play();
    viewer.update(200);
    expect(viewer.getState()).toBe('ended');

    viewer.seekToFrame(50);
    expect(viewer.getState()).toBe('paused');
  });

  // ── Frame delivery ────────────────────────────────────────────

  it('delivers frames via callback', async () => {
    await viewer.load(new Uint8Array(10));

    const frames: number[] = [];
    viewer.onFrame((_state, tick) => {
      frames.push(tick);
    });

    viewer.play();
    viewer.update(100); // 2 frames at 20Hz

    // Should have delivered: initial frame (0) + 2 advances = frame 0 (play's immediate) + frame 1 + frame 2
    // But play() delivers frame 0, then update delivers frames 1 and 2
    expect(frames.length).toBeGreaterThanOrEqual(2);
  });

  it('delivers frame on seek', async () => {
    await viewer.load(new Uint8Array(10));

    const frames: number[] = [];
    viewer.onFrame((_state, tick) => {
      frames.push(tick);
    });

    viewer.seekToFrame(50);
    expect(frames.length).toBe(1);
    expect(frames[0]).toBe(150); // tick = 50 * 3
  });

  // ── State callbacks ───────────────────────────────────────────

  it('notifies on state changes', async () => {
    const states: DemoViewerState[] = [];
    viewer.onStateChange((s) => states.push(s));

    await viewer.load(new Uint8Array(10));
    viewer.play();
    viewer.pause();

    expect(states).toEqual(['loaded', 'playing', 'paused']);
  });

  // ── Info ───────────────────────────────────────────────────────

  it('returns complete viewer info', async () => {
    await viewer.load(new Uint8Array(10));
    viewer.seekToFrame(50);

    const info = viewer.getInfo();
    expect(info.state).toBe('loaded');
    expect(info.currentFrame).toBe(50);
    expect(info.totalFrames).toBe(100);
    expect(info.durationMs).toBe(5000);
    expect(info.playbackSpeed).toBe(1.0);
  });

  it('returns progress', async () => {
    await viewer.load(new Uint8Array(10));
    viewer.seekToFrame(0);
    expect(viewer.getProgress()).toBe(0);

    viewer.seekToFrame(99);
    expect(viewer.getProgress()).toBe(1);

    viewer.seekToFrame(50);
    expect(viewer.getProgress()).toBeCloseTo(50 / 99);
  });

  // ── Cleanup ───────────────────────────────────────────────────

  it('disposes cleanly', async () => {
    await viewer.load(new Uint8Array(10));
    viewer.dispose();
    expect(viewer.getState()).toBe('idle');
    expect(viewer.isLoaded()).toBe(false);
  });

  // ── Play from ended ───────────────────────────────────────────

  it('restarts from beginning when playing from ended state', async () => {
    await viewer.load(new Uint8Array(10));
    viewer.play();
    viewer.seekToFrame(98);
    viewer.play();
    viewer.update(200);
    expect(viewer.getState()).toBe('ended');

    viewer.play();
    expect(viewer.getState()).toBe('playing');
    expect(viewer.getCurrentFrame()).toBe(0);
  });
});
