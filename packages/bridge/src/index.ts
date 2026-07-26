import { BridgeMessageRouter } from "./bridge/message-router.js";
import { NativeMessageDecoder, writeNativeMessage } from "./native-messaging.js";

const router = await BridgeMessageRouter.create();
const decoder = new NativeMessageDecoder();

process.stdin.on("data", (chunk: Buffer) => {
  let messages: unknown[];
  try {
    messages = decoder.push(chunk);
  } catch (error) {
    process.stderr.write(`[auto-page-agent] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }
  for (const message of messages) void router.handle(message, writeNativeMessage);
});

process.stdin.on("end", () => router.stop());
