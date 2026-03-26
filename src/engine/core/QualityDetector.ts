/**
 * QualityDetector - Automatic quality detection based on device capabilities
 *
 * Detects device performance characteristics and recommends quality settings.
 * Critical for mobile optimization - ensures smooth gameplay on low-end devices.
 *
 * Usage:
 *   const detector = QualityDetector.getInstance();
 *   const quality = detector.detectQuality();
 *   TextureMemoryManager.getInstance().setQuality(quality);
 */

import type { QualityLevel } from "../loader";

export interface DeviceInfo {
  /** Device type */
  type: "desktop" | "mobile" | "tablet";
  /** Platform */
  platform: "windows" | "macos" | "linux" | "android" | "ios" | "unknown";
  /** Approximate GPU tier (1=low, 2=mid, 3=high) */
  gpuTier: 1 | 2 | 3;
  /** Available memory in MB (estimated) */
  memoryMB: number;
  /** Screen pixel count */
  screenPixels: number;
  /** Is touch device */
  isTouch: boolean;
  /** Device pixel ratio */
  pixelRatio: number;
  /** CPU cores (if available) */
  cpuCores: number;
}

export interface QualityRecommendation {
  /** Recommended quality level */
  quality: QualityLevel;
  /** Device info used for decision */
  deviceInfo: DeviceInfo;
  /** Explanation of recommendation */
  reason: string;
}

/**
 * Detects device capabilities and recommends quality settings
 */
export class QualityDetector {
  private static instance: QualityDetector;
  private cachedDeviceInfo: DeviceInfo | null = null;

  private constructor() {}

  public static getInstance(): QualityDetector {
    if (!QualityDetector.instance) {
      QualityDetector.instance = new QualityDetector();
    }
    return QualityDetector.instance;
  }

  /**
   * Detect device information
   */
  public getDeviceInfo(): DeviceInfo {
    if (this.cachedDeviceInfo) {
      return this.cachedDeviceInfo;
    }

    const info: DeviceInfo = {
      type: this.detectDeviceType(),
      platform: this.detectPlatform(),
      gpuTier: this.detectGPUTier(),
      memoryMB: this.detectMemory(),
      screenPixels: this.getScreenPixels(),
      isTouch: this.isTouchDevice(),
      pixelRatio: window.devicePixelRatio || 1,
      cpuCores: navigator.hardwareConcurrency || 4,
    };

    this.cachedDeviceInfo = info;
    return info;
  }

  /**
   * Detect and recommend quality level
   */
  public detectQuality(): QualityRecommendation {
    const info = this.getDeviceInfo();
    let quality: QualityLevel;
    let reason: string;

    // Mobile devices get reduced quality by default
    if (info.type === "mobile") {
      if (info.gpuTier >= 3 && info.memoryMB >= 4096) {
        quality = "high";
        reason = "High-end mobile device detected";
      } else if (info.gpuTier >= 2 && info.memoryMB >= 2048) {
        quality = "medium";
        reason = "Mid-range mobile device detected";
      } else {
        quality = "low";
        reason = "Low-end mobile device detected";
      }
    }
    // Tablets get medium-high quality
    else if (info.type === "tablet") {
      if (info.gpuTier >= 3) {
        quality = "high";
        reason = "High-end tablet detected";
      } else {
        quality = "medium";
        reason = "Tablet device detected";
      }
    }
    // Desktop gets full quality unless low-end
    else {
      if (info.gpuTier >= 3 && info.memoryMB >= 8192) {
        quality = "ultra";
        reason = "High-end desktop detected";
      } else if (info.gpuTier >= 2 && info.memoryMB >= 4096) {
        quality = "high";
        reason = "Mid-range desktop detected";
      } else if (info.memoryMB >= 2048) {
        quality = "medium";
        reason = "Low-end desktop detected";
      } else {
        quality = "low";
        reason = "Very low-end system detected";
      }
    }

    console.log(`[QualityDetector] Recommended: ${quality} (${reason})`);

    return { quality, deviceInfo: info, reason };
  }

  /**
   * Get recommended texture budget in MB
   */
  public getRecommendedTextureBudget(): number {
    const info = this.getDeviceInfo();

    // Use fraction of available memory for textures
    const fraction = info.type === "mobile" ? 0.1 : 0.15;
    const budget = Math.floor(info.memoryMB * fraction);

    // Clamp to reasonable range
    return Math.max(32, Math.min(512, budget));
  }

  /**
   * Get recommended max texture size
   */
  public getRecommendedMaxTextureSize(): number {
    const info = this.getDeviceInfo();

    if (info.type === "mobile") {
      return info.gpuTier >= 3 ? 1024 : 512;
    }

    if (info.gpuTier >= 3) return 4096;
    if (info.gpuTier >= 2) return 2048;
    return 1024;
  }

  /**
   * Detect device type (mobile/tablet/desktop)
   */
  private detectDeviceType(): "desktop" | "mobile" | "tablet" {
    if (typeof navigator === "undefined") return "desktop";

    const ua = navigator.userAgent.toLowerCase();

    // Check for tablets first (they often match mobile patterns too)
    if (/ipad|tablet|playbook|silk/.test(ua)) {
      return "tablet";
    }

    // Check for mobile
    if (/mobile|android|iphone|ipod|blackberry|opera mini|iemobile/.test(ua)) {
      // Android tablets don't always have "tablet" in UA, check screen size
      if (window.innerWidth >= 768 && window.innerHeight >= 768) {
        return "tablet";
      }
      return "mobile";
    }

    // Touch device with large screen might be tablet
    if (this.isTouchDevice() && window.innerWidth >= 1024) {
      return "tablet";
    }

    return "desktop";
  }

  /**
   * Detect platform
   */
  private detectPlatform(): DeviceInfo["platform"] {
    if (typeof navigator === "undefined") return "unknown";

    const ua = navigator.userAgent.toLowerCase();
    const platform = (navigator.platform || "").toLowerCase();

    if (/android/.test(ua)) return "android";
    if (/iphone|ipad|ipod/.test(ua)) return "ios";
    if (/win/.test(platform)) return "windows";
    if (/mac/.test(platform)) return "macos";
    if (/linux/.test(platform)) return "linux";

    return "unknown";
  }

  /**
   * Detect GPU tier based on WebGL capabilities
   */
  private detectGPUTier(): 1 | 2 | 3 {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");

      if (!gl) return 1;

      // Check for high-end GPU indicators
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL).toLowerCase();

        // High-end desktop GPUs
        if (/rtx|radeon rx [567]|geforce gtx 10[678]|geforce gtx 16|radeon vii/.test(renderer)) {
          return 3;
        }

        // Mid-range GPUs
        if (/geforce|radeon|intel iris|intel uhd|adreno 6|mali-g7/.test(renderer)) {
          return 2;
        }

        // Integrated/low-end GPUs
        if (/intel hd|adreno [345]|mali-[gt]|powervr/.test(renderer)) {
          return 1;
        }
      }

      // Fallback: check max texture size as proxy for GPU capability
      const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      if (maxTextureSize >= 16384) return 3;
      if (maxTextureSize >= 8192) return 2;
      return 1;
    } catch {
      return 1;
    }
  }

  /**
   * Detect available memory (estimated)
   */
  private detectMemory(): number {
    // Try to use Device Memory API (Chrome 63+)
    if ("deviceMemory" in navigator) {
      return (navigator as any).deviceMemory * 1024; // GB to MB
    }

    // Fallback estimates based on device type
    const type = this.detectDeviceType();
    if (type === "mobile") return 2048; // 2GB estimate
    if (type === "tablet") return 4096; // 4GB estimate
    return 8192; // 8GB estimate for desktop
  }

  /**
   * Get screen pixel count
   */
  private getScreenPixels(): number {
    return window.screen.width * window.screen.height * (window.devicePixelRatio || 1);
  }

  /**
   * Check if touch device
   */
  private isTouchDevice(): boolean {
    return "ontouchstart" in window || navigator.maxTouchPoints > 0 || (navigator as any).msMaxTouchPoints > 0;
  }

  /**
   * Clear cached device info (for testing)
   */
  public clearCache(): void {
    this.cachedDeviceInfo = null;
  }

  /**
   * Reset singleton (for testing)
   */
  public static resetInstance(): void {
    QualityDetector.instance = null as any;
  }
}
