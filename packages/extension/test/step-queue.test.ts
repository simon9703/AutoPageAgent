import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserActionStep, PageSnapshot } from "@auto-page-agent/shared";
import { rebindQueuedStep } from "../src/background/step-queue.js";

const snapshot = {
  snapshotId: "snapshot-2",
  url: "https://example.com",
  title: "Example",
  language: "en",
  selectedText: "",
  headings: [],
  mainText: "",
  simplifiedDom: "",
  pageInfo: {
    viewportWidth: 1000,
    viewportHeight: 800,
    pageWidth: 1000,
    pageHeight: 800,
    scrollX: 0,
    scrollY: 0,
    pixelsAbove: 0,
    pixelsBelow: 0,
  },
  elements: [{
    ref: "element-new",
    tagName: "button",
    role: "button",
    label: "Save",
    text: "Save",
    selector: "button",
    disabled: false,
    sensitive: false,
    contentEditable: false,
    fingerprint: "save-button-1",
    inViewport: true,
    occluded: false,
    readonly: false,
    viewportRect: { x: 0, y: 0, width: 100, height: 40 },
  }],
  capturedAt: new Date().toISOString(),
  domVersion: 2,
} satisfies PageSnapshot;

test("queued steps bind a trusted fingerprint to the latest ref", () => {
  const step: BrowserActionStep = {
    action: "click",
    targetRef: "element-old",
    targetFingerprint: "save-button-1",
    reason: "Save",
  };
  assert.equal(rebindQueuedStep(step, snapshot)?.targetRef, "element-new");
});

test("queued steps stop when the target is missing, ambiguous, or no longer writable", () => {
  const step: BrowserActionStep = {
    action: "fill",
    targetRef: "element-old",
    targetFingerprint: "save-button-1",
    value: "draft",
    reason: "Fill",
  };
  assert.equal(rebindQueuedStep(step, { ...snapshot, elements: [] }), undefined);
  assert.equal(rebindQueuedStep(step, {
    ...snapshot,
    elements: [snapshot.elements[0]!, { ...snapshot.elements[0]!, ref: "element-other" }],
  }), undefined);
  assert.equal(rebindQueuedStep(step, {
    ...snapshot,
    elements: [{ ...snapshot.elements[0]!, readonly: true }],
  }), undefined);
});

test("page scroll remains queueable without a target fingerprint", () => {
  const rebound = rebindQueuedStep({ action: "scroll", direction: "down", reason: "Continue" }, snapshot);
  assert.equal(rebound?.action, "scroll");
});
