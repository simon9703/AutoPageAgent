import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserActionStep, PageSnapshot, PageSnapshotDiff } from "@auto-page-agent/shared";
import { getActionSettlePolicy } from "../src/content/action-settle.js";
import { hasObservableActionEffect } from "../src/content/action-verification.js";

const snapshot: PageSnapshot = {
  snapshotId: "snapshot-1",
  url: "https://example.com",
  title: "Example",
  language: "en",
  selectedText: "",
  headings: [],
  mainText: "",
  simplifiedDom: "<button>Save</button>",
  pageInfo: {
    viewportWidth: 1_000,
    viewportHeight: 800,
    pageWidth: 1_000,
    pageHeight: 2_000,
    scrollX: 0,
    scrollY: 0,
    pixelsAbove: 0,
    pixelsBelow: 1_200,
  },
  elements: [],
  performance: {
    resources: [],
    apiRequests: [],
    summary: { requestCount: 0, totalTransferSize: 0, slowRequestCount: 0 },
  },
  capturedAt: "2026-07-23T00:00:00.000Z",
  domVersion: 1,
};

const click: BrowserActionStep = { action: "click", targetRef: "save", reason: "Save" };
const scroll: BrowserActionStep = { action: "scroll", direction: "down", reason: "Continue" };
const noDiff: PageSnapshotDiff = {
  urlChanged: false,
  titleChanged: false,
  addedFingerprints: [],
  removedFingerprints: [],
  changedFingerprints: [],
  summary: [],
};

test("click verification rejects a dispatch with no observable page effect", () => {
  assert.equal(hasObservableActionEffect(click, snapshot, snapshot, noDiff), false);
});

test("click verification accepts an observable URL change", () => {
  const after = { ...snapshot, snapshotId: "snapshot-2", url: "https://example.com/saved" };
  const diff = { ...noDiff, urlChanged: true, summary: ["URL changed"] };
  assert.equal(hasObservableActionEffect(click, snapshot, after, diff), true);
});

test("scroll verification requires the viewport to move", () => {
  assert.equal(hasObservableActionEffect(scroll, snapshot, snapshot, noDiff), false);

  const after = {
    ...snapshot,
    snapshotId: "snapshot-2",
    pageInfo: { ...snapshot.pageInfo, scrollY: 600, pixelsAbove: 600, pixelsBelow: 600 },
  };
  assert.equal(hasObservableActionEffect(scroll, snapshot, after, noDiff), true);
});

test("settle policy keeps direct state updates short and async actions bounded", () => {
  assert.deepEqual(getActionSettlePolicy("fill"), { maxWaitMs: 160, quietMs: 80 });
  assert.deepEqual(getActionSettlePolicy("focus"), { maxWaitMs: 160, quietMs: 80 });
  assert.deepEqual(getActionSettlePolicy("select"), { maxWaitMs: 900, quietMs: 180 });
  assert.deepEqual(getActionSettlePolicy("scroll"), { maxWaitMs: 700, quietMs: 160 });
  assert.deepEqual(getActionSettlePolicy("click"), { maxWaitMs: 1_800, quietMs: 250 });
  assert.deepEqual(getActionSettlePolicy("submit"), { maxWaitMs: 1_800, quietMs: 250 });
});
