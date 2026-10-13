/**
 * NetGraph — Network statistics overlay (Quake 3 / Source-style)
 *
 * Displays real-time networking diagnostics as a canvas overlay.
 * Toggled via `cl_netgraph` CVar (0=off, 1=text, 2=text+graph).
 *
 * Metrics tracked:
 * - Ping (RTT) from server snapshots
 * - Snapshot receive rate (measured)
 * - Packet loss % (detected via snapshot tick gaps)
 * - Interpolation delay (from SnapshotBuffer)
 * - Command send rate
 * - Reconciliation corrections/sec
 *
 * Usage:
 *   NetGraph.init() — call once after engine boot
 *   NetGraph.recordSnapshot(ping, tick) — call on each server snapshot
 *   NetGraph.recordReconciliation() — call on each reconciliation correction
 *   NetGraph.recordCommandSent() — call on each command sent
 *   NetGraph.render() — call each frame
 */

import { Cvar } from "../../core/Cvar";
import { SnapshotBuffer } from "./SnapshotBuffer";

// ============================================================================
// Configuration
// ============================================================================

const GRAPH_WIDTH = 300;
const GRAPH_HEIGHT = 64;
const GRAPH_PADDING = 8;
const HISTORY_SIZE = 128; // Number of samples in the rolling graph
const SAMPLE_INTERVAL_MS = 100; // Sample metrics every 100ms
const LOSS_WINDOW_SIZE = 100; // Track last N snapshots for loss %

// Colors
const BG_COLOR = "rgba(0, 0, 0, 0.65)";
const TEXT_COLOR = "#e0e0e0";
const PING_COLOR = "#4fc3f7"; // Light blue
const SNAP_COLOR = "#81c784"; // Green
const CMD_COLOR = "#ffb74d"; // Orange
const RECON_COLOR = "#ef5350"; // Red
const LOSS_COLOR = "#ff7043"; // Deep orange
const GRAPH_LINE_COLOR = "rgba(255, 255, 255, 0.1)";

// ============================================================================
// Rolling Counter — tracks events per second
// ============================================================================

class RollingCounter {
  private timestamps: number[] = [];
  private windowMs: number;

  constructor(windowMs = 1000) {
    this.windowMs = windowMs;
  }

  record(now = performance.now()): void {
    this.timestamps.push(now);
    this.prune(now);
  }

  rate(now = performance.now()): number {
    this.prune(now);
    return this.timestamps.length / (this.windowMs / 1000);
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }
}

// ============================================================================
// NetGraph Singleton
// ============================================================================

export class NetGraph {
  private static instance: NetGraph | null = null;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  // Metrics
  private currentPing = 0;
  private pingHistory: number[] = [];
  private snapshotCounter = new RollingCounter(1000);
  private commandCounter = new RollingCounter(1000);
  private reconciliationCounter = new RollingCounter(1000);

  private interpDelayMs = 0;
  private clockOffsetMs = 0;
  private lastSampleTime = 0;

  // Packet loss tracking (tick gap detection)
  private lastSnapshotTick = -1;
  private ticksPerSnapshot = 4; // refined from recent gaps unless explicitly configured
  private tickStepDetected = false;
  /** Bounded recent gaps; recomputed when the inferred cadence changes. */
  private snapshotGaps: number[] = [];
  private lastDrawTime = -Infinity;
  private lastDrawLevel = 0;
  private packetLossPct = 0;

  // Graph data (sampled at fixed intervals)
  private pingGraph: number[] = new Array(HISTORY_SIZE).fill(0);
  private snapRateGraph: number[] = new Array(HISTORY_SIZE).fill(0);

  private constructor() {}

  // ========================================================================
  // Lifecycle
  // ========================================================================

  static init(): void {
    if (NetGraph.instance) return;
    NetGraph.instance = new NetGraph();

    // Register cl_netgraph cvar
    Cvar.register("cl_netgraph", 0, {
      type: "int",
      min: 0,
      max: 2,
      description: "Network graph overlay (0=off, 1=text, 2=text+graph)",
      onChange: (value) => {
        const inst = NetGraph.instance;
        if (!inst) return;
        if (value === 0) {
          inst.destroyCanvas();
        } else {
          inst.ensureCanvas();
        }
      },
    });

    // Register interpolation CVars (cl_timenudge, cl_interp)
    SnapshotBuffer.registerCVars();
  }

  /** Forget the prior connection's timings and histories. Visibility remains a preference. */
  static reset(): void {
    if (!NetGraph.instance) return;
    NetGraph.instance.destroyCanvas();
    NetGraph.instance = new NetGraph();
  }

  static getInstance(): NetGraph | null {
    return NetGraph.instance;
  }

  // ========================================================================
  // Data Recording (called from network code)
  // ========================================================================

  /** Call on each received server snapshot */
  static recordSnapshot(pingMs: number, tick?: number): void {
    const inst = NetGraph.instance;
    if (!inst) return;
    inst.currentPing = pingMs;
    inst.snapshotCounter.record();
    inst.pingHistory.push(pingMs);
    if (inst.pingHistory.length > 60) inst.pingHistory.shift();

    // Packet loss detection via tick gaps
    if (tick !== undefined && tick > 0) {
      inst.recordTickForLoss(tick);
    }
  }

  /** Call on each reconciliation correction */
  static recordReconciliation(): void {
    NetGraph.instance?.reconciliationCounter.record();
  }

  /** Call on each command sent to server */
  static recordCommandSent(): void {
    NetGraph.instance?.commandCounter.record();
  }

  /** Set current interpolation delay from SnapshotBuffer */
  static setInterpDelay(delayMs: number): void {
    if (NetGraph.instance) {
      NetGraph.instance.interpDelayMs = delayMs;
    }
  }

  /** Configure expected ticks-per-snapshot for accurate loss detection */
  static setTicksPerSnapshot(tps: number): void {
    if (NetGraph.instance && Number.isFinite(tps) && tps > 0) {
      NetGraph.instance.ticksPerSnapshot = tps;
      NetGraph.instance.tickStepDetected = true;
    }
  }

  /** Set clock offset from ClockSync (server - client in ms) */
  static setClockOffset(offsetMs: number): void {
    if (NetGraph.instance) {
      NetGraph.instance.clockOffsetMs = offsetMs;
    }
  }

  // ========================================================================
  // Rendering (call each frame)
  // ========================================================================

  static render(): void {
    const inst = NetGraph.instance;
    if (!inst) return;

    const level = Cvar.getNumber("cl_netgraph");
    if (level <= 0) return;

    inst.ensureCanvas();
    if (!inst.ctx || !inst.canvas) return;

    // Sample graph data at fixed intervals
    const now = performance.now();
    if (level === inst.lastDrawLevel && now - inst.lastDrawTime < SAMPLE_INTERVAL_MS) return;
    inst.lastDrawTime = now;
    inst.lastDrawLevel = level;
    if (now - inst.lastSampleTime > SAMPLE_INTERVAL_MS) {
      inst.lastSampleTime = now;
      inst.pingGraph.push(inst.currentPing);
      if (inst.pingGraph.length > HISTORY_SIZE) inst.pingGraph.shift();
      inst.snapRateGraph.push(inst.packetLossPct);
      if (inst.snapRateGraph.length > HISTORY_SIZE) inst.snapRateGraph.shift();
    }

    const ctx = inst.ctx;
    const showGraph = level >= 2;

    // Calculate panel dimensions
    const lineHeight = 16;
    const textLines = 7;
    const panelHeight = textLines * lineHeight + GRAPH_PADDING * 2 + (showGraph ? GRAPH_HEIGHT + GRAPH_PADDING : 0);
    const panelWidth = GRAPH_WIDTH + GRAPH_PADDING * 2;

    // Resize canvas to panel
    if (inst.canvas.width !== panelWidth) inst.canvas.width = panelWidth;
    if (inst.canvas.height !== panelHeight) inst.canvas.height = panelHeight;
    ctx.clearRect(0, 0, panelWidth, panelHeight);
    ctx.beginPath();

    // Background
    ctx.fillStyle = BG_COLOR;
    ctx.roundRect(0, 0, panelWidth, panelHeight, 4);
    ctx.fill();

    // Text metrics
    ctx.font = '12px "Consolas", "Courier New", monospace';
    ctx.textBaseline = "top";

    const x = GRAPH_PADDING;
    let y = GRAPH_PADDING;

    const ping = inst.currentPing;
    const snapRate = inst.snapshotCounter.rate(now);
    const cmdRate = inst.commandCounter.rate(now);
    const reconRate = inst.reconciliationCounter.rate(now);
    const interp = inst.interpDelayMs;

    // Ping
    ctx.fillStyle = ping > 100 ? RECON_COLOR : ping > 50 ? CMD_COLOR : PING_COLOR;
    ctx.fillText(`ping: ${ping.toFixed(0)}ms`, x, y);
    y += lineHeight;

    // Snapshot rate + packet loss
    ctx.fillStyle = snapRate < 15 ? RECON_COLOR : SNAP_COLOR;
    ctx.fillText(`snap: ${snapRate.toFixed(0)}/s`, x, y);
    // Packet loss on same line
    const loss = inst.packetLossPct;
    ctx.fillStyle = loss > 5 ? RECON_COLOR : loss > 1 ? LOSS_COLOR : TEXT_COLOR;
    ctx.fillText(`gaps: ${loss.toFixed(1)}%`, x + 120, y);
    y += lineHeight;

    // Interp delay
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText(`interp: ${interp.toFixed(0)}ms`, x, y);
    // Command rate on same line
    ctx.fillStyle = CMD_COLOR;
    ctx.fillText(`cmd: ${cmdRate.toFixed(0)}/s`, x + 120, y);
    y += lineHeight;

    // Reconciliation rate
    ctx.fillStyle = reconRate > 5 ? RECON_COLOR : TEXT_COLOR;
    ctx.fillText(`recon: ${reconRate.toFixed(1)}/s`, x, y);
    y += lineHeight;

    // Avg ping
    const avgPing =
      inst.pingHistory.length > 0 ? inst.pingHistory.reduce((a, b) => a + b, 0) / inst.pingHistory.length : 0;
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText(`avg:  ${avgPing.toFixed(0)}ms`, x, y);
    y += lineHeight;

    // Clock offset (ClockSync)
    const clkOff = inst.clockOffsetMs;
    ctx.fillStyle = Math.abs(clkOff) > 500 ? CMD_COLOR : TEXT_COLOR;
    ctx.fillText(`clock: ${clkOff >= 0 ? "+" : ""}${clkOff.toFixed(0)}ms`, x, y);
    y += lineHeight;

    // Graph (level 2 only)
    if (showGraph) {
      y += GRAPH_PADDING / 2;
      // Top graph: ping history
      const halfH = Math.floor((GRAPH_HEIGHT - 2) / 2);
      inst.drawGraph(ctx, x, y, GRAPH_WIDTH, halfH, inst.pingGraph, PING_COLOR, 200);
      // Bottom graph: packet loss %
      inst.drawGraph(ctx, x, y + halfH + 2, GRAPH_WIDTH, halfH, inst.snapRateGraph, LOSS_COLOR, 10);
    }
  }

  // ========================================================================
  // Canvas Management
  // ========================================================================

  private ensureCanvas(): void {
    if (this.canvas) return;

    this.canvas = document.createElement("canvas");
    this.canvas.id = "netgraph-overlay";
    this.canvas.style.cssText = `
      position: fixed;
      bottom: 8px;
      right: 8px;
      z-index: 9999;
      pointer-events: none;
      image-rendering: pixelated;
    `;
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
  }

  private destroyCanvas(): void {
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
      this.ctx = null;
      this.lastDrawTime = -Infinity;
    }
  }

  // ========================================================================
  // Graph Drawing
  // ========================================================================

  private drawGraph(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    data: number[],
    color: string,
    maxValue: number,
  ): void {
    // Background
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.fillRect(x, y, w, h);

    // Grid lines (25%, 50%, 75%)
    ctx.strokeStyle = GRAPH_LINE_COLOR;
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const gy = y + h * (1 - i / 4);
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x + w, gy);
      ctx.stroke();
    }

    // Data bars
    if (data.length === 0) return;
    const barWidth = w / HISTORY_SIZE;

    ctx.fillStyle = color;
    for (let i = 0; i < data.length; i++) {
      const val = Math.min(data[i], maxValue);
      const barH = (val / maxValue) * h;
      ctx.fillRect(x + i * barWidth, y + h - barH, Math.max(barWidth - 0.5, 1), barH);
    }

    // Scale labels
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = "9px monospace";
    ctx.fillText(`${maxValue}`, x + 2, y + 2);
    ctx.fillText("0", x + 2, y + h - 10);
  }

  // ========================================================================
  // Packet Loss Tracking
  // ========================================================================

  /**
   * Track snapshot ticks to detect gaps (lost packets).
   * If we expect snapshots every N ticks and see a jump of 2N,
   * that means one snapshot was lost.
   */
  private recordTickForLoss(tick: number): void {
    if (this.lastSnapshotTick < 0) {
      // First snapshot — just record, no loss info yet
      this.lastSnapshotTick = tick;
      return;
    }

    const gap = tick - this.lastSnapshotTick;
    if (gap <= 0) return;
    this.lastSnapshotTick = tick;
    this.snapshotGaps.push(gap);
    if (this.snapshotGaps.length > LOSS_WINDOW_SIZE) this.snapshotGaps.shift();

    // Welcome currently carries simulation rate, not snapshot cadence. Infer
    // from the smallest recent gap; an initially lost snapshot must not latch it.
    const step = this.tickStepDetected ? this.ticksPerSnapshot : Math.min(...this.snapshotGaps);
    this.ticksPerSnapshot = step;
    let samples = 0;
    let lost = 0;
    for (let i = this.snapshotGaps.length - 1; i >= 0 && samples < LOSS_WINDOW_SIZE; i--) {
      const expected = Math.max(1, Math.round(this.snapshotGaps[i] / step));
      const count = Math.min(expected, LOSS_WINDOW_SIZE - samples);
      samples += count;
      lost += count - 1;
    }
    this.packetLossPct = samples ? (lost / samples) * 100 : 0;
  }
}
