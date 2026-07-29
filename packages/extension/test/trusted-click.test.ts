import assert from "node:assert/strict";
import test from "node:test";
import {
  dispatchTrustedViewportClick,
  validateTrustedClickPoint,
} from "../src/background/trusted-click.js";

test("trusted popup dismissal dispatches a bounded CDP mouse click and detaches", async () => {
  const calls: Array<{ kind: string; value?: unknown }> = [];
  const debuggerApi = {
    attach: async (target: { tabId: number }, version: string) => {
      calls.push({ kind: "attach", value: { target, version } });
    },
    sendCommand: async (_target: { tabId: number }, method: string, params?: object) => {
      calls.push({ kind: method, value: params });
      return {};
    },
    detach: async (target: { tabId: number }) => {
      calls.push({ kind: "detach", value: target });
    },
  };

  await dispatchTrustedViewportClick(42, { x: 120.4, y: 80.6 }, debuggerApi, async () => {
    calls.push({ kind: "wait" });
  });

  assert.deepEqual(calls.map(({ kind }) => kind), [
    "attach",
    "Input.dispatchMouseEvent",
    "Input.dispatchMouseEvent",
    "wait",
    "Input.dispatchMouseEvent",
    "detach",
  ]);
  assert.deepEqual(calls[1]?.value, {
    type: "mouseMoved",
    x: 120,
    y: 81,
    button: "none",
    buttons: 0,
    pointerType: "mouse",
  });
  assert.deepEqual(calls[2]?.value, {
    type: "mousePressed",
    x: 120,
    y: 81,
    button: "left",
    buttons: 1,
    clickCount: 1,
    pointerType: "mouse",
  });
  assert.deepEqual(calls[4]?.value, {
    type: "mouseReleased",
    x: 120,
    y: 81,
    button: "left",
    buttons: 0,
    clickCount: 1,
    pointerType: "mouse",
  });
});

test("trusted popup dismissal detaches after a CDP command failure", async () => {
  const calls: string[] = [];
  const debuggerApi = {
    attach: async () => { calls.push("attach"); },
    sendCommand: async () => {
      calls.push("command");
      throw new Error("CDP failed");
    },
    detach: async () => { calls.push("detach"); },
  };

  await assert.rejects(
    dispatchTrustedViewportClick(42, { x: 10, y: 20 }, debuggerApi),
    /CDP failed/u,
  );
  assert.deepEqual(calls, ["attach", "command", "detach"]);
});

test("trusted popup dismissal rejects invalid coordinates before attaching", () => {
  assert.throws(() => validateTrustedClickPoint({ x: Number.NaN, y: 10 }), /coordinate range/u);
  assert.throws(() => validateTrustedClickPoint({ x: -1, y: 10 }), /coordinate range/u);
  assert.throws(() => validateTrustedClickPoint({ x: 10, y: 100_001 }), /coordinate range/u);
});
