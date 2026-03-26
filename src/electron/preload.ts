/**
 * Electron Preload Script
 *
 * Runs in the renderer process before the web content loads.
 * Provides a secure bridge between the renderer and main process.
 *
 * This exposes specific APIs to the renderer via contextBridge,
 * keeping nodeIntegration disabled for security.
 */

import { contextBridge, ipcRenderer } from "electron";

/**
 * Exposed API for the renderer process
 * Access via window.electronAPI in the game
 */
const electronAPI = {
  /**
   * Platform information
   */
  platform: process.platform,

  /**
   * Check if running in Electron
   */
  isElectron: true,

  /**
   * Get app version
   */
  getVersion: (): Promise<string> => ipcRenderer.invoke("get-version"),

  /**
   * Window controls
   */
  window: {
    minimize: () => ipcRenderer.send("window-minimize"),
    maximize: () => ipcRenderer.send("window-maximize"),
    close: () => ipcRenderer.send("window-close"),
    setFullscreen: (fullscreen: boolean) => ipcRenderer.send("window-fullscreen", fullscreen),
    isFullscreen: (): Promise<boolean> => ipcRenderer.invoke("window-is-fullscreen"),
  },

  /**
   * Native dialogs (optional, for future use)
   */
  dialog: {
    showMessage: (options: { title: string; message: string; type?: string }): Promise<void> =>
      ipcRenderer.invoke("dialog-message", options),
  },

  /**
   * File system operations (optional, for save files)
   * Currently saves use localStorage which works fine in Electron
   */
  // fs: {
  //   readFile: (path: string): Promise<string> => ipcRenderer.invoke('fs-read', path),
  //   writeFile: (path: string, data: string): Promise<void> => ipcRenderer.invoke('fs-write', path, data),
  // },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", electronAPI);

// Type declaration for the renderer
declare global {
  interface Window {
    electronAPI?: typeof electronAPI;
  }
}
