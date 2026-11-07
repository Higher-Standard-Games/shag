import type { LoopSfxPlayOptions, SfxLoop, SfxPlayOptions, SpatialSfxPlayOptions } from "./AudioV2Sfx";

export interface SfxPosition {
  x: number;
  y: number;
  z: number;
}

/** An isolated presentation owner may collect resolved sound requests instead of speaker playback. */
export interface SfxSink {
  readonly nowMs?: number;
  preload(paths: readonly string[], options?: LoopSfxPlayOptions): Promise<void>;
  play2D(path: string, options: SfxPlayOptions): void;
  play3D(path: string, position: SfxPosition, options: SpatialSfxPlayOptions): void;
  playLoop3D(
    path: string,
    position: SfxPosition | null,
    options: LoopSfxPlayOptions,
    signal?: AbortSignal,
  ): Promise<SfxLoop | null>;
}
