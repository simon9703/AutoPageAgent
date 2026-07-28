import assert from "node:assert/strict";
import test from "node:test";
import type { PageElementSnapshot, PageSnapshot } from "@auto-page-agent/shared";
import { selectScreenshotMarks } from "../src/background/screenshot-marks.js";

function element(
  ref: string,
  viewportRect: PageElementSnapshot["viewportRect"],
  overrides: Partial<PageElementSnapshot> = {},
): PageElementSnapshot {
  return {
    ref,
    tagName: "button",
    role: "button",
    label: ref,
    text: ref,
    selector: "button",
    disabled: false,
    sensitive: false,
    contentEditable: false,
    fingerprint: ref,
    inViewport: true,
    occluded: false,
    readonly: false,
    viewportRect,
    ...overrides,
  };
}

const snapshot: PageSnapshot = {
  snapshotId: "snapshot-1",
  url: "https://example.com",
  title: "Example",
  language: "en",
  selectedText: "",
  headings: [],
  mainText: "",
  simplifiedDom: "",
  pageInfo: {
    viewportWidth: 1_000,
    viewportHeight: 800,
    pageWidth: 1_000,
    pageHeight: 1_600,
    scrollX: 0,
    scrollY: 0,
    pixelsAbove: 0,
    pixelsBelow: 800,
  },
  elements: [],
  capturedAt: "2026-07-28T00:00:00.000Z",
  domVersion: 1,
};

test("visual marks keep the snapshot-global element index and current ref", () => {
  const marks = selectScreenshotMarks({
    ...snapshot,
    elements: [
      element("hidden", { x: 0, y: 0, width: 10, height: 10 }, { inViewport: false }),
      element("submit", { x: 100, y: 200, width: 120, height: 40 }),
    ],
  });
  assert.deepEqual(marks, [{
    index: 2,
    ref: "submit",
    rect: { x: 100, y: 200, width: 120, height: 40 },
  }]);
});

test("visual marks omit unsafe, occluded, disabled, and container targets", () => {
  const marks = selectScreenshotMarks({
    ...snapshot,
    elements: [
      element("safe", { x: -10, y: 20, width: 40, height: 30 }),
      element("sensitive", { x: 20, y: 20, width: 40, height: 30 }, { sensitive: true }),
      element("occluded", { x: 20, y: 20, width: 40, height: 30 }, { occluded: true }),
      element("disabled", { x: 20, y: 20, width: 40, height: 30 }, { disabled: true }),
      element("dialog", { x: 0, y: 0, width: 800, height: 700 }, { role: "dialog" }),
    ],
  });
  assert.deepEqual(marks, [{
    index: 1,
    ref: "safe",
    rect: { x: 0, y: 20, width: 30, height: 30 },
  }]);
});

test("visual marks are bounded", () => {
  const elements = Array.from({ length: 100 }, (_, index) =>
    element(`element-${index}`, { x: 10, y: 10, width: 20, height: 20 }));
  assert.equal(selectScreenshotMarks({ ...snapshot, elements }).length, 80);
  assert.equal(selectScreenshotMarks({ ...snapshot, elements }, 3).length, 3);
});
