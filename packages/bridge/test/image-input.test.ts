import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { prepareCodexImageInput } from "../src/agent/image-input.js";

test("passes public images to Codex as remote image input", async () => {
  const prepared = await prepareCodexImageInput("https://example.com/image.png");
  assert.deepEqual(prepared.item, { type: "image", url: "https://example.com/image.png" });
  await prepared.cleanup();
});

test("materializes data images only for the Codex turn and removes them afterward", async () => {
  const prepared = await prepareCodexImageInput("data:image/jpeg;base64,aGVsbG8=");
  assert.equal(prepared.item?.type, "localImage");
  if (prepared.item?.type !== "localImage") return;
  assert.equal((await readFile(prepared.item.path)).toString(), "hello");
  await prepared.cleanup();
  await assert.rejects(access(prepared.item.path));
});

test("ignores unsupported and oversized image inputs", async () => {
  assert.equal((await prepareCodexImageInput("file:///tmp/secret.png")).item, undefined);
  const oversized = `data:image/png;base64,${Buffer.alloc(1_500_001).toString("base64")}`;
  assert.equal((await prepareCodexImageInput(oversized)).item, undefined);
});
