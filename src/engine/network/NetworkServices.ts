import { NetworkManager } from './NetworkManager';

/**
 * Get the NetworkManager singleton instance
 */
export function getNetworkManager(): NetworkManager {
  return NetworkManager.getInstance();
}
