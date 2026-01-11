/**
 * Base interface for all networked components.
 * Components are data containers that can be serialized and synchronized.
 */
export interface IComponent {
  /** Serialize component state to binary */
  serialize(encoder: StateEncoder): void;

  /** Deserialize component state from binary */
  deserialize(decoder: StateDecoder): void;

  /** Clone component for snapshots */
  clone(): IComponent;
}

/**
 * Binary state encoder for efficient serialization
 */
export class StateEncoder {
  private data: number[] = [];

  writeUint8(value: number): void {
    this.data.push(value & 0xFF);
  }

  writeUint16(value: number): void {
    this.data.push((value >> 8) & 0xFF, value & 0xFF);
  }

  writeUint32(value: number): void {
    this.data.push(
      (value >> 24) & 0xFF,
      (value >> 16) & 0xFF,
      (value >> 8) & 0xFF,
      value & 0xFF
    );
  }

  writeFloat32(value: number): void {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setFloat32(0, value, true);
    const bytes = new Uint8Array(buffer);
    this.data.push(...bytes);
  }

  writeBool(value: boolean): void {
    this.data.push(value ? 1 : 0);
  }

  writeString(value: string): void {
    const utf8 = new TextEncoder().encode(value);
    this.writeUint16(utf8.length);
    this.data.push(...utf8);
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.data);
  }
}

/**
 * Binary state decoder for efficient deserialization
 */
export class StateDecoder {
  private data: Uint8Array;
  private offset = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  readUint8(): number {
    return this.data[this.offset++];
  }

  readUint16(): number {
    const value = (this.data[this.offset] << 8) | this.data[this.offset + 1];
    this.offset += 2;
    return value;
  }

  readUint32(): number {
    const value = 
      (this.data[this.offset] << 24) |
      (this.data[this.offset + 1] << 16) |
      (this.data[this.offset + 2] << 8) |
      this.data[this.offset + 3];
    this.offset += 4;
    return value;
  }

  readFloat32(): number {
    const buffer = this.data.slice(this.offset, this.offset + 4);
    const view = new DataView(buffer.buffer, buffer.byteOffset);
    this.offset += 4;
    return view.getFloat32(0, true);
  }

  readBool(): boolean {
    return this.data[this.offset++] !== 0;
  }

  readString(): string {
    const length = this.readUint16();
    const utf8 = this.data.slice(this.offset, this.offset + length);
    this.offset += length;
    return new TextDecoder().decode(utf8);
  }
}
