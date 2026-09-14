import { GameState } from "../core/GameState";
import { MessageCodec, MissingSnapshotBaselineError } from "../protocol/MessageCodec";

/**
 * Live snapshot acceptance shared by the browser, bots and headless clients.
 * Missing dependencies are not ACKed or published. The server periodically sends
 * full snapshots, so an evicted baseline cannot cause a permanent decode loop.
 * History belongs to a connection, not a player life; reset on reconnect only.
 */
export class SnapshotReceiver {
  private readonly history = new Map<number, GameState>();
  private latestTick: number | null = null;
  private static readonly HISTORY_SIZE = 128;

  receive(data: Uint8Array): GameState | null {
    const { tick } = MessageCodec.readSnapshotHeader(data);
    if (this.latestTick !== null && tick <= this.latestTick) return null;

    let snapshot: GameState;
    try {
      snapshot = MessageCodec.decodeSnapshot(data, this.history);
    } catch (error) {
      if (error instanceof MissingSnapshotBaselineError) return null;
      throw error;
    }

    // Store only the components used for delta decoding. Keep them independent
    // of consumers: prediction/game callbacks may mutate the published state.
    const baseline = new GameState();
    baseline.tick = snapshot.tick;
    for (const [id, entity] of snapshot.entities) baseline.entities.set(id, entity.clone());
    for (const [id, player] of snapshot.players) baseline.players.set(id, player.clone());
    this.history.set(snapshot.tick, baseline);
    while (this.history.size > SnapshotReceiver.HISTORY_SIZE) {
      this.history.delete(this.history.keys().next().value!);
    }
    this.latestTick = snapshot.tick;
    return snapshot;
  }

  reset(): void {
    this.history.clear();
    this.latestTick = null;
  }
}
