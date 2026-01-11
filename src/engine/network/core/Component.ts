// Re-export BinaryEncoder as StateEncoder and BinaryDecoder as StateDecoder
// for backwards compatibility with existing code
import { BinaryEncoder, BinaryDecoder } from '../protocol/BinaryProtocol';
export { BinaryEncoder as StateEncoder, BinaryDecoder as StateDecoder };

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
