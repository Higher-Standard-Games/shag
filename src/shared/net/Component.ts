// Re-export BinaryEncoder as StateEncoder and BinaryDecoder as StateDecoder
// for backwards compatibility with existing code
import { BinaryDecoder, BinaryEncoder } from "./BinaryProtocol";

export { BinaryDecoder as StateDecoder, BinaryEncoder as StateEncoder };

/**
 * Base interface for all networked components.
 * Components are data containers that can be serialized and synchronized.
 */
export interface IComponent {
  /** Serialize component state to binary */
  serialize(encoder: BinaryEncoder): void;

  /** Deserialize component state from binary */
  deserialize(decoder: BinaryDecoder): void;

  /** Clone component for snapshots */
  clone(): IComponent;
}
