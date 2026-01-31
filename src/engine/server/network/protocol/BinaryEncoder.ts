/**
 * Binary Encoder/Decoder (Stub)
 * TODO: Port from existing BinaryProtocol.ts in Phase 2
 */

export class BinaryEncoder {
    private buffer: DataView;
    private offset: number = 0;

    constructor(size: number = 1024) {
        this.buffer = new DataView(new ArrayBuffer(size));
    }

    writeUint8(value: number): void {
        this.buffer.setUint8(this.offset++, value);
    }

    writeUint16(value: number): void {
        this.buffer.setUint16(this.offset, value, true);
        this.offset += 2;
    }

    writeUint32(value: number): void {
        this.buffer.setUint32(this.offset, value, true);
        this.offset += 4;
    }

    writeFloat32(value: number): void {
        this.buffer.setFloat32(this.offset, value, true);
        this.offset += 4;
    }

    toBytes(): Uint8Array {
        return new Uint8Array(this.buffer.buffer, 0, this.offset);
    }
}

export class BinaryDecoder {
    private buffer: DataView;
    private offset: number = 0;

    constructor(bytes: Uint8Array) {
        this.buffer = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    readUint8(): number {
        return this.buffer.getUint8(this.offset++);
    }

    readUint16(): number {
        const value = this.buffer.getUint16(this.offset, true);
        this.offset += 2;
        return value;
    }

    readUint32(): number {
        const value = this.buffer.getUint32(this.offset, true);
        this.offset += 4;
        return value;
    }

    readFloat32(): number {
        const value = this.buffer.getFloat32(this.offset, true);
        this.offset += 4;
        return value;
    }
}
