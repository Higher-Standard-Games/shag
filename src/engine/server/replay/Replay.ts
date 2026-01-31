/**
 * Replay Recorder
 * 
 * Records simulation inputs for later playback to verify determinism.
 * Format is simple: tick-by-tick list of all inputs.
 */

import type { InputCommand } from '../network/protocol/InputProtocol';
import type { PlayerId, TickNumber } from '../ecs/types';

// ═══════════════════════════════════════════════════════════════════
// REPLAY FORMAT
// ═══════════════════════════════════════════════════════════════════

export interface ReplayHeader {
    version: number;
    mapName: string;
    startTime: number;
    tickRate: number;
    seed?: number;
}

export interface ReplayFrame {
    tick: TickNumber;
    inputs: Map<PlayerId, InputCommand>;
    events: ReplayEvent[];
}

export interface ReplayEvent {
    type: 'player_join' | 'player_leave' | 'spawn' | 'kill';
    playerId: PlayerId;
    data?: unknown;
}

export interface ReplayData {
    header: ReplayHeader;
    frames: ReplayFrame[];
    finalChecksum: number;
}

// ═══════════════════════════════════════════════════════════════════
// REPLAY RECORDER
// ═══════════════════════════════════════════════════════════════════

export class ReplayRecorder {
    private header: ReplayHeader;
    private frames: ReplayFrame[] = [];
    private currentFrame: ReplayFrame | null = null;
    private recording: boolean = false;

    constructor(mapName: string, tickRate: number, seed?: number) {
        this.header = {
            version: 1,
            mapName,
            startTime: Date.now(),
            tickRate,
            seed,
        };
    }

    /**
     * Start recording
     */
    start(): void {
        this.recording = true;
        this.frames = [];
    }

    /**
     * Stop recording and return replay data
     */
    stop(finalChecksum: number): ReplayData {
        this.recording = false;

        // Flush current frame
        if (this.currentFrame) {
            this.frames.push(this.currentFrame);
            this.currentFrame = null;
        }

        return {
            header: this.header,
            frames: this.frames,
            finalChecksum,
        };
    }

    /**
     * Begin a new tick frame
     */
    beginTick(tick: TickNumber): void {
        if (!this.recording) return;

        // Save previous frame
        if (this.currentFrame) {
            this.frames.push(this.currentFrame);
        }

        this.currentFrame = {
            tick,
            inputs: new Map(),
            events: [],
        };
    }

    /**
     * Record player input for current tick
     */
    recordInput(playerId: PlayerId, input: InputCommand): void {
        if (!this.recording || !this.currentFrame) return;
        this.currentFrame.inputs.set(playerId, { ...input });
    }

    /**
     * Record an event
     */
    recordEvent(event: ReplayEvent): void {
        if (!this.recording || !this.currentFrame) return;
        this.currentFrame.events.push(event);
    }

    /**
     * Get current frame count
     */
    get frameCount(): number {
        return this.frames.length + (this.currentFrame ? 1 : 0);
    }

    /**
     * Check if recording
     */
    get isRecording(): boolean {
        return this.recording;
    }

    /**
     * Export to JSON
     */
    toJSON(finalChecksum: number): string {
        const data = this.stop(finalChecksum);

        // Convert Maps to arrays for JSON
        const jsonFrames = data.frames.map(frame => ({
            tick: frame.tick,
            inputs: Array.from(frame.inputs.entries()).map(([pid, input]) => ({
                playerId: pid,
                input,
            })),
            events: frame.events,
        }));

        return JSON.stringify({
            header: data.header,
            frames: jsonFrames,
            finalChecksum: data.finalChecksum,
        }, null, 2);
    }
}

// ═══════════════════════════════════════════════════════════════════
// REPLAY PLAYER
// ═══════════════════════════════════════════════════════════════════

export class ReplayPlayer {
    private data: ReplayData;
    private frameIndex: number = 0;

    constructor(data: ReplayData) {
        this.data = data;
    }

    /**
     * Load from JSON
     */
    static fromJSON(json: string): ReplayPlayer {
        const parsed = JSON.parse(json);

        // Convert arrays back to Maps
        const frames: ReplayFrame[] = parsed.frames.map((frame: {
            tick: number;
            inputs: { playerId: number; input: InputCommand }[];
            events: ReplayEvent[];
        }) => ({
            tick: frame.tick as TickNumber,
            inputs: new Map(frame.inputs.map((i: { playerId: number; input: InputCommand }) =>
                [i.playerId as PlayerId, i.input]
            )),
            events: frame.events,
        }));

        return new ReplayPlayer({
            header: parsed.header,
            frames,
            finalChecksum: parsed.finalChecksum,
        });
    }

    /**
     * Get replay header
     */
    get header(): ReplayHeader {
        return this.data.header;
    }

    /**
     * Get expected final checksum
     */
    get expectedChecksum(): number {
        return this.data.finalChecksum;
    }

    /**
     * Get total frame count
     */
    get totalFrames(): number {
        return this.data.frames.length;
    }

    /**
     * Get current frame index
     */
    get currentFrameIndex(): number {
        return this.frameIndex;
    }

    /**
     * Reset to beginning
     */
    reset(): void {
        this.frameIndex = 0;
    }

    /**
     * Check if more frames available
     */
    hasNextFrame(): boolean {
        return this.frameIndex < this.data.frames.length;
    }

    /**
     * Get next frame
     */
    nextFrame(): ReplayFrame | null {
        if (!this.hasNextFrame()) return null;
        return this.data.frames[this.frameIndex++];
    }

    /**
     * Peek at next frame without advancing
     */
    peekFrame(): ReplayFrame | null {
        if (!this.hasNextFrame()) return null;
        return this.data.frames[this.frameIndex];
    }

    /**
     * Get frame at specific index
     */
    getFrame(index: number): ReplayFrame | null {
        if (index < 0 || index >= this.data.frames.length) return null;
        return this.data.frames[index];
    }
}
