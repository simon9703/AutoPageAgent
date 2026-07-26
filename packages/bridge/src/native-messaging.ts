const HEADER_BYTES = 4;
const MAX_NATIVE_MESSAGE_BYTES = 64 * 1024 * 1024;

export function encodeNativeMessage(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.length > MAX_NATIVE_MESSAGE_BYTES) throw new Error("Native message exceeds the 64 MB Chrome limit.");
  const header = Buffer.allocUnsafe(HEADER_BYTES);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export class NativeMessageDecoder {
  #buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.#buffer = this.#buffer.length ? Buffer.concat([this.#buffer, chunk]) : chunk;
    const messages: unknown[] = [];
    while (this.#buffer.length >= HEADER_BYTES) {
      const length = this.#buffer.readUInt32LE(0);
      if (length > MAX_NATIVE_MESSAGE_BYTES) throw new Error("Native message exceeds the 64 MB Chrome limit.");
      if (this.#buffer.length < HEADER_BYTES + length) break;
      const payload = this.#buffer.subarray(HEADER_BYTES, HEADER_BYTES + length);
      this.#buffer = this.#buffer.subarray(HEADER_BYTES + length);
      messages.push(JSON.parse(payload.toString("utf8")) as unknown);
    }
    return messages;
  }
}

export function writeNativeMessage(value: unknown): void {
  process.stdout.write(encodeNativeMessage(value));
}
