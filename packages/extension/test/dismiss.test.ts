import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  clickSafePopupExterior,
  dismissPopupWithFallbacks,
  dispatchEscapeKey,
  findSafeDismissPoint,
  type DismissKeyboardTarget,
  type DismissRect,
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

test("popup dismiss tries synthetic Escape, trusted Escape, then safe exterior click", async () => {
  const calls: string[] = [];
  let open = true;

  const dismissed = await dismissPopupWithFallbacks({
    dispatchSyntheticEscape: () => { calls.push("synthetic Escape"); },
    dispatchTrustedEscape: () => { calls.push("trusted Escape"); },
    clickSafeExterior: () => {
      calls.push("safe exterior click");
      open = false;
      return true;
    },
    isOpen: () => {
      calls.push("check open");
      return open;
    },
    afterKeyboardAttempt: () => { calls.push("wait"); },
  });

  assert.equal(dismissed, true);
  assert.deepEqual(calls, [
    "synthetic Escape",
    "wait",
    "check open",
    "trusted Escape",
    "wait",
    "check open",
    "safe exterior click",
  ]);
});

test("popup dismiss stops after trusted Escape closes the popup", async () => {
  const calls: string[] = [];
  let checks = 0;

  const dismissed = await dismissPopupWithFallbacks({
    dispatchSyntheticEscape: () => { calls.push("synthetic Escape"); },
    dispatchTrustedEscape: () => { calls.push("trusted Escape"); },
    clickSafeExterior: () => {
      calls.push("safe exterior click");
      return false;
    },
    isOpen: () => {
      checks += 1;
      return checks === 1;
    },
    afterKeyboardAttempt: () => undefined,
  });

  assert.equal(dismissed, true);
  assert.deepEqual(calls, ["synthetic Escape", "trusted Escape"]);
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

  assert.deepEqual(result, { point: { x: 200, y: 12 }, target: "safe-target" });
  assert.deepEqual(visited, [{ x: 200, y: 12 }]);
});

test("unsafe exterior candidates are skipped without inventing a fallback coordinate", () => {
  const result = findSafeDismissPoint(
    { left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300 },
    [{ left: 250, top: 180, right: 450, bottom: 350, width: 200, height: 170 }],
    () => undefined,
  );

  assert.equal(result, undefined);
});

test("popup dismiss rejects a proxy wrapper and performs only one safe outside click", async () => {
  class FakeElement {
    readonly children: FakeElement[] = [];
    readonly style = { cursor: "default", display: "block", visibility: "visible", position: "static", zIndex: "auto" };
    parentElement: FakeElement | null = null;
    isConnected = true;

    constructor(
      readonly tagName: string,
      readonly attributes: Record<string, string> = {},
      readonly rect: DismissRect = { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 },
    ) {}

    append(...children: FakeElement[]): void {
      for (const child of children) {
        child.parentElement = this;
        this.children.push(child);
      }
    }

    getAttribute(name: string): string | null {
      return this.attributes[name] ?? null;
    }

    setAttribute(name: string, value: string): void {
      this.attributes[name] = value;
    }

    getBoundingClientRect(): DismissRect {
      return this.rect;
    }

    matches(selector: string): boolean {
      return selector.split(",").some((part) => {
        const candidate = part.trim();
        if (/^[a-z]+$/u.test(candidate)) return this.tagName === candidate;
        if (candidate === "a[href]") return this.tagName === "a" && "href" in this.attributes;
        if (candidate === "[onclick]") return "onclick" in this.attributes;
        if (candidate === "[data-auto-page-agent-overlay]") return "data-auto-page-agent-overlay" in this.attributes;
        const role = /^\[role=(?:'|")([^'"]+)(?:'|")\]$/u.exec(candidate)?.[1];
        return role ? this.attributes.role === role : false;
      });
    }

    closest(selector: string): FakeElement | null {
      for (let current: FakeElement | null = this; current; current = current.parentElement) {
        if (current.matches(selector)) return current;
      }
      return null;
    }

    querySelector(selector: string): FakeElement | null {
      for (const child of this.children) {
        if (child.matches(selector)) return child;
        const nested = child.querySelector(selector);
        if (nested) return nested;
      }
      return null;
    }

    contains(candidate: FakeElement): boolean {
      return candidate === this || this.children.some((child) => child.contains(candidate));
    }
  }

  const viewport: DismissRect = { left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 };
  const dialog = new FakeElement("div", { role: "dialog" }, viewport);
  const selectWrapper = new FakeElement("div");
  const combobox = new FakeElement("input", {
    role: "combobox",
    "aria-expanded": "true",
    "aria-controls": "site-options",
  });
  const popup = new FakeElement(
    "div",
    { id: "site-options", role: "listbox" },
    { left: 120, top: 80, right: 320, bottom: 240, width: 200, height: 160 },
  );
  const passiveContent = new FakeElement("div");
  const title = new FakeElement("h2");
  selectWrapper.append(combobox);
  dialog.append(selectWrapper, passiveContent, title, popup);

  const activated: Array<{ x: number; y: number }> = [];
  const originalGlobals = {
    HTMLElement: globalThis.HTMLElement,
    document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle,
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
  };
  Object.assign(globalThis, {
    HTMLElement: FakeElement,
    innerWidth: 400,
    innerHeight: 300,
    getComputedStyle: (element: FakeElement) => element.style,
    document: {
      body: new FakeElement("body"),
      documentElement: new FakeElement("html"),
      getElementById: (id: string) => id === "site-options" ? popup : null,
      querySelectorAll: (selector: string) => selector === '[role="dialog"]' ? [dialog] : [],
      elementsFromPoint: (x: number, y: number) => {
        if (y !== 12) return [];
        if (x === 200) return [selectWrapper, dialog];
        if (x === 100) return [passiveContent, dialog];
        if (x === 300) return [title, dialog];
        return [dialog];
      },
    },
  });

  try {
    const dismissed = await clickSafePopupExterior(
      combobox as unknown as HTMLElement,
      undefined,
      async (point) => {
        activated.push(point);
      },
    );

    assert.equal(dismissed, false);
    assert.deepEqual(activated, [{ x: 100, y: 12 }]);
    assert.equal(combobox.getAttribute("aria-expanded"), "true");
    assert.equal(popup.isConnected, true);
  } finally {
    Object.assign(globalThis, originalGlobals);
  }
});

test("popup dismiss runtime wires synthetic and trusted Escape before safe exterior click", async () => {
  const runtime = await readFile(new URL("../src/content/runtime.ts", import.meta.url), "utf8");
  const dismissBody = /function dismissElement[\s\S]+?\n\}\n\nasync function requestTrustedDismissEscape/u.exec(runtime)?.[0] ?? "";

  assert.match(dismissBody, /function dismissElement\([\s\S]+element: HTMLElement,[\s\S]+snapshotRole\?: string,[\s\S]+recoveredOption\?: RecoveredOption,[\s\S]+\): Promise<void>/u);
  assert.match(dismissBody, /role === "combobox" \|\| role === "listbox" \|\| role === "menu" \|\| role === "option"/u);
  assert.match(dismissBody, /recoveredOption\?\.semanticElement\.getAttribute\("aria-selected"\)/u);
  assert.match(dismissBody, /dismissPopupWithFallbacks\(\{[\s\S]+dispatchSyntheticEscape: \(\) => dispatchEscapeKey\(element\)[\s\S]+dispatchTrustedEscape: requestTrustedDismissEscape[\s\S]+clickSafeExterior: \(\) => clickSafePopupExterior\(/u);
  assert.match(dismissBody, /showAiPointerAtPoint\(point\.x, point\.y, "AI · dismiss"\)[\s\S]+requestTrustedDismissClick[\s\S]+await delay\(250\)/u);
  assert.ok(dismissBody.indexOf("dispatchEscapeKey(element)") < dismissBody.indexOf("requestTrustedDismissEscape"));
  assert.ok(dismissBody.indexOf("requestTrustedDismissEscape") < dismissBody.indexOf("clickSafePopupExterior"));
  assert.doesNotMatch(dismissBody, /role === "dialog"|allowDialogDismiss/u);
});
