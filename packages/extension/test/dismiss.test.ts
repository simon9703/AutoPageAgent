import assert from "node:assert/strict";
import test from "node:test";
import { blurComboboxAfterFailedDismiss, dispatchEscapeKey, type DismissKeyboardTarget } from "../src/content/dismiss.js";

function createTarget(role = "combobox") {
  const calls: string[] = [];
  const events: Event[] = [];
  const target: DismissKeyboardTarget = {
    focus: () => { calls.push("focus"); },
    blur: () => { calls.push("blur"); },
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

test("blur fallback is restricted to the resolved combobox recipient", () => {
  const combobox = createTarget("combobox");
  const listbox = createTarget("listbox");
  assert.equal(blurComboboxAfterFailedDismiss(combobox.target), true);
  assert.equal(blurComboboxAfterFailedDismiss(listbox.target), false);
  assert.equal(blurComboboxAfterFailedDismiss(undefined), false);
  assert.deepEqual(combobox.calls, ["blur"]);
  assert.deepEqual(listbox.calls, []);
});
