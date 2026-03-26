/**
 * TFBackend — TensorFlow.js Backend Abstraction
 *
 * Provides a single import point for TensorFlow.js that:
 *   1. Tries @tensorflow/tfjs-node (native C++ backend, fast)
 *   2. Falls back to @tensorflow/tfjs (WASM/CPU, always works)
 *
 * Usage:
 *   import { initTF, getTF } from './TFBackend';
 *
 * This avoids scattering try/catch dynamic imports throughout the codebase.
 * All bot files that need TF.js should import from here, not directly.
 */

// We use a dynamic resolution approach: try native first, fall back gracefully.
// The resolved module is cached by Node.js after first import.

let _tf: typeof import("@tensorflow/tfjs-node") | null = null;
let _backend: "tensorflow" | "cpu" | "wasm" | "none" = "none";
let _initPromise: Promise<void> | null = null;

/**
 * Initialize TensorFlow.js with the best available backend.
 * Safe to call multiple times — only initializes once.
 */
export async function initTF(): Promise<void> {
  if (_tf) return;
  if (_initPromise) return _initPromise;

  _initPromise = _doInit();
  return _initPromise;
}

async function _doInit(): Promise<void> {
  // Try 1: Native C++ backend (@tensorflow/tfjs-node)
  try {
    const mod = await import("@tensorflow/tfjs-node");
    _tf = mod;
    _backend = (mod.getBackend?.() as typeof _backend) || "tensorflow";
    console.log(`[TFBackend] Loaded @tensorflow/tfjs-node (backend: ${_backend})`);
    return;
  } catch {
    console.warn("[TFBackend] @tensorflow/tfjs-node not available, trying pure JS fallback...");
  }

  // Try 2: Pure JS backend (@tensorflow/tfjs — WASM or CPU)
  try {
    const mod = (await import("@tensorflow/tfjs")) as unknown as typeof import("@tensorflow/tfjs-node");
    _tf = mod;
    _backend = (mod.getBackend?.() as typeof _backend) || "cpu";
    console.log(`[TFBackend] Loaded @tensorflow/tfjs (backend: ${_backend})`);
    return;
  } catch {
    console.error("[TFBackend] No TensorFlow.js backend available!");
    console.error("[TFBackend] Install with: npm install @tensorflow/tfjs-node");
    _backend = "none";
  }
}

/**
 * Get the initialized TF.js module.
 * Throws if initTF() hasn't been called or failed.
 */
export function getTF(): typeof import("@tensorflow/tfjs-node") {
  if (!_tf) {
    throw new Error("[TFBackend] TensorFlow.js not initialized. Call await initTF() first.");
  }
  return _tf;
}

/** Which backend is active */
export function getBackendName(): string {
  return _backend;
}

/** Whether TF.js is available */
export function isTFAvailable(): boolean {
  return _tf !== null;
}
