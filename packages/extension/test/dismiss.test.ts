import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  dispatchEscapeKey,
  findSafeDismissPoint,
  type DismissKeyboardTarget,
} from "../src/content/dismiss.js";

function createTarget(role = "combobox") {
  const calls: string[] = [];
  const events: Event[] = [];
  const target: DismissKeyboardTarget = {
    focus: () => { calls.push("focus"); },
    dispatchEvent: (event) => {
      calls.push(event.type);
      events.push(event);
      return true;
    },
    getAttribute: (name) => name === "role" ? role : null,
  };
  return { target, calls, events };
}

test("dismiss focuses before sending complete Escape keydown and keyup events", () => {
  const { target, calls, events } = createTarget();
  dispatchEscapeKey(target, (type, init) => {
    const event = new Event(type, init);
    Object.assign(event, {
      key: init.key,
      code: init.code,
      location: init.location,
      repeat: init.repeat,
      isComposing: init.isComposing,
    });
    return event;
  });

  assert.deepEqual(calls, ["focus", "keydown", "keyup"]);
  for (const event of events) {
    assert.equal((event as Event & { key: string }).key, "Escape");
    assert.equal((event as Event & { code: string }).code, "Escape");
    assert.equal((event as Event & { keyCode: number }).keyCode, 27);
    assert.equal((event as Event & { which: number }).which, 27);
    assert.equal(event.bubbles, true);
    assert.equal(event.cancelable, true);
  }
});

test("safe exterior point is selected outside the popup boundary", () => {
  const visited: Array<{ x: number; y: number }> = [];
  const result = findSafeDismissPoint(
    { left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 },
    [{ left: 0, top: 0, right: 180, bottom: 120, width: 180, height: 120 }],
    (point) => {
      visited.push(point);
      return "safe-target";
    },
  );

  assert.deepEqual(result, { point: { x: 388, y: 12 }, target: "safe-target" });
  assert.deepEqual(visited, [{ x: 388, y: 12 }]);
});

test("unsafe exterior candidates are skipped without inventing a fallback coordinate", () => {
  const result = findSafeDismissPoint(
    { left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300 },
    [{ left: 250, top: 180, right: 450, bottom: 350, width: 200, height: 170 }],
    () => undefined,
  );

  assert.equal(result, undefined);
});

test("popup dismiss tries Escape before resolving a safe exterior click", async () => {
  const runtime = await readFile(new URL("../src/content/runtime.ts", import.meta.url), "utf8");
  const dismissBody = /function dismissElement[\s\S]+?\n\}\n\nfunction getTopmostVisibleDialog/u.exec(runtime)?.[0] ?? "";

  assert.match(dismissBody, /function dismissElement\(element: HTMLElement, allowFilledDialog: boolean\): Promise<void>/u);
  assert.match(dismissBody, /role === "combobox" \|\| role === "listbox" \|\| role === "menu" \|\| role === "option"/u);
  assert.match(dismissBody, /dispatchEscapeKey\(element\)[\s\S]+isPopupDismissTargetOpen\(element\)[\s\S]+await clickSafePopupExterior\(/u);
  assert.match(dismissBody, /showAiPointerAtPoint\(point\.x, point\.y, "AI · dismiss"\)[\s\S]+requestTrustedDismissClick/u);
  assert.ok(dismissBody.indexOf("dispatchEscapeKey(element)") < dismissBody.indexOf("clickSafePopupExterior"));
});
