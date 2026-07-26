import assert from "node:assert/strict";
import test from "node:test";
import { encodeNativeMessage, NativeMessageDecoder } from "../src/native-messaging.js";

test("native messaging decoder handles fragmented frames", () => {
  const encoded = encodeNativeMessage({ id: "one", type: "health.check" });
  const decoder = new NativeMessageDecoder();
  assert.deepEqual(decoder.push(encoded.subarray(0, 3)), []);
  assert.deepEqual(decoder.push(encoded.subarray(3, 9)), []);
  assert.deepEqual(decoder.push(encoded.subarray(9)), [{ id: "one", type: "health.check" }]);
});

test("native messaging decoder handles multiple frames in one chunk", () => {
  const decoder = new NativeMessageDecoder();
  const chunk = Buffer.concat([
    encodeNativeMessage({ id: "one" }),
    encodeNativeMessage({ id: "two" }),
  ]);
  assert.deepEqual(decoder.push(chunk), [{ id: "one" }, { id: "two" }]);
});
