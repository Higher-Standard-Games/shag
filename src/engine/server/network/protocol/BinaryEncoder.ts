/**
 * Binary Encoder/Decoder
 * 
 * High-performance binary serialization for network protocol.
 * Little-endian, compact representation.
 */

// ═══════════════════════════════════════════════════════════════════
// BINARY ENCODER
// ═══════════════════════════════════════════════════════════════════

export class BinaryEncoder {
    private buffer: ArrayBuffer;
    private view: DataView;
    private offset: number = 0;

    constructor(initialSize: number = 1024) {
        this.buffer = new ArrayBuffer(initialSize);
        this.view = new DataView(this.buffer);
    }

    // ─── PRIMITIVES ───

    writeUint8(value: number): void {
        this.ensureCapacity(1);
        this.view.setUint8(this.offset++, value);
    }

    writeInt8(value: number): void {
        this.ensureCapacity(1);
        this.view.setInt8(this.offset++, value);
    }

    writeUint16(value: number): void {
        this.ensureCapacity(2);
        this.view.setUint16(this.offset, value, true);
        this.offset += 2;
    }

    writeInt16(value: number): void {
        this.ensureCapacity(2);
        this.view.setInt16(this.offset, value, true);
        this.offset += 2;
    }

    writeUint32(value: number): void {
        this.ensureCapacity(4);
        this.view.setUint32(this.offset, value, true);
        this.offset += 4;
    }

    writeInt32(value: number): void {
        this.ensureCapacity(4);
        this.view.setInt32(this.offset, value, true);
        this.offset += 4;
    }

    writeFloat32(value: number): void {
        this.ensureCapacity(4);
        this.view.setFloat32(this.offset, value, true);
        this.offset += 4;
    }

    writeFloat64(value: number): void {
        this.ensureCapacity(8);
        this.view.setFloat64(this.offset, value, true);
        this.offset += 8;
    }

    // ─── VARIABLE LENGTH ───

    /**
     * Write variable-length unsigned integer (1-5 bytes)
     * Uses LEB128 encoding for compact representation
     */
    writeVarUint(value: number): void {
        while (value >= 0x80) {
            this.writeUint8((value & 0x7F) | 0x80);
            value >>>= 7;
        }
        this.writeUint8(value);
    }

    /**
     * Write variable-length signed integer
     */
    writeVarInt(value: number): void {
        // ZigZag encoding for efficient signed numbers
        const zigzag = (value << 1) ^ (value >> 31);
        this.writeVarUint(zigzag >>> 0);
    }

    // ─── STRINGS ───

    writeString(str: string): void {
        const bytes = new TextEncoder().encode(str);
        this.writeVarUint(bytes.length);
        this.writeBytes(bytes);
    }

    // ─── BYTES ───

    writeBytes(bytes: Uint8Array): void {
        this.ensureCapacity(bytes.length);
        new Uint8Array(this.buffer, this.offset, bytes.length).set(bytes);
        this.offset += bytes.length;
    }

    // ─── VECTORS ───

    writeVec3(x: number, y: number, z: number): void {
        this.writeFloat32(x);
        this.writeFloat32(y);
        this.writeFloat32(z);
    }

    /**
     * Write quantized position (16-bit per component, ~0.5 unit precision)
     * Range: -32768 to 32767 units
     */
    writeQuantizedPos(x: number, y: number, z: number): void {
        this.writeInt16(Math.round(x * 2));
        this.writeInt16(Math.round(y * 2));
        this.writeInt16(Math.round(z * 2));
    }

    /**
     * Write quantized angle (8-bit, ~1.4 degree precision)
     */
    writeQuantizedAngle(degrees: number): void {
        // Normalize to 0-255 range
        const normalized = ((degrees % 360) + 360) % 360;
        this.writeUint8(Math.round((normalized / 360) * 255));
    }

    // ─── OUTPUT ───

    toBytes(): Uint8Array {
        return new Uint8Array(this.buffer, 0, this.offset);
    }

    get length(): number {
        return this.offset;
    }

    reset(): void {
        this.offset = 0;
    }

    // ─── INTERNAL ───

    private ensureCapacity(bytes: number): void {
        if (this.offset + bytes > this.buffer.byteLength) {
            // Double buffer size
            const newBuffer = new ArrayBuffer(this.buffer.byteLength * 2);
            new Uint8Array(newBuffer).set(new Uint8Array(this.buffer));
            this.buffer = newBuffer;
            this.view = new DataView(this.buffer);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
// BINARY DECODER
// ═══════════════════════════════════════════════════════════════════

export class BinaryDecoder {
    private view: DataView;
    private offset: number = 0;

    constructor(bytes: Uint8Array) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    // ─── PRIMITIVES ───

    readUint8(): number {
        return this.view.getUint8(this.offset++);
    }

    readInt8(): number {
        return this.view.getInt8(this.offset++);
    }

    readUint16(): number {
        const value = this.view.getUint16(this.offset, true);
        this.offset += 2;
        return value;
    }

    readInt16(): number {
        const value = this.view.getInt16(this.offset, true);
        this.offset += 2;
        return value;
    }

    readUint32(): number {
        const value = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return value;
    }

    readInt32(): number {
        const value = this.view.getInt32(this.offset, true);
        this.offset += 4;
        return value;
    }

    readFloat32(): number {
        const value = this.view.getFloat32(this.offset, true);
        this.offset += 4;
        return value;
    }

    readFloat64(): number {
        const value = this.view.getFloat64(this.offset, true);
        this.offset += 8;
        return value;
    }

    // ─── VARIABLE LENGTH ───

    readVarUint(): number {
        let result = 0;
        let shift = 0;
        let byte: number;

        do {
            byte = this.readUint8();
            result |= (byte & 0x7F) << shift;
            shift += 7;
        } while (byte >= 0x80);

        return result >>> 0;
    }

    readVarInt(): number {
        const zigzag = this.readVarUint();
        // Decode ZigZag
        return (zigzag >>> 1) ^ -(zigzag & 1);
    }

    // ─── STRINGS ───

    readString(): string {
        const length = this.readVarUint();
        const bytes = this.readBytes(length);
        return new TextDecoder().decode(bytes);
    }

    // ─── BYTES ───

    readBytes(length: number): Uint8Array {
        const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
        this.offset += length;
        return bytes;
    }

    // ─── VECTORS ───

    readVec3(): { x: number; y: number; z: number } {
        return {
            x: this.readFloat32(),
            y: this.readFloat32(),
            z: this.readFloat32(),
        };
    }

    readQuantizedPos(): { x: number; y: number; z: number } {
        return {
            x: this.readInt16() / 2,
            y: this.readInt16() / 2,
            z: this.readInt16() / 2,
        };
    }

    readQuantizedAngle(): number {
        return (this.readUint8() / 255) * 360;
    }

    // ─── STATE ───

    get bytesRemaining(): number {
        return this.view.byteLength - this.offset;
    }

    get position(): number {
        return this.offset;
    }
}
