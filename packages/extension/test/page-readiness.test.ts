import assert from "node:assert/strict";
import test from "node:test";
import type { AgentLoopContext, PageElementSnapshot, PageSnapshot } from "@auto-page-agent/shared";
import {
  boundedObserveTimeout,
  getBlockedRecoveryBoundary,
  hasVisibleBusyState,
  semanticSnapshotSignature,
  waitForPageDecisionReadiness,
} from "../src/background/page-readiness.js";

const baseSnapshot: PageSnapshot = {
  snapshotId: "snapshot-1",
  url: "https://example.com/market",
  title: "Market",
  language: "en",
  selectedText: "",
  headings: [{ level: 1, text: "FAQ" }],
  mainText: "FAQ",
  simplifiedDom: "<button data-ai-ref=\"old-ref\">FAQ</button>",
  pageInfo: {
    viewportWidth: 1_000,
    viewportHeight: 800,
    pageWidth: 1_000,
    pageHeight: 1_000,
    scrollX: 0,
    scrollY: 0,
    pixelsAbove: 0,
    pixelsBelow: 200,
  },
  elements: [],
  capturedAt: "2026-07-28T00:00:00.000Z",
  domVersion: 1,
};

const btcButton: PageElementSnapshot = {
  ref: "btc-new-ref",
  tagName: "button",
  role: "button",
  label: "Buy BTC",
  text: "Buy BTC",
  selector: "button",
  disabled: false,
  sensitive: false,
  contentEditable: false,
  fingerprint: "btc-buy",
  inViewport: true,
  occluded: false,
  readonly: false,
  viewportRect: { x: 10, y: 10, width: 120, height: 40 },
};

test("semantic comparison ignores fresh ids and layout-only snapshot churn", () => {
  const refreshed = {
    ...baseSnapshot,
    snapshotId: "snapshot-2",
    simplifiedDom: "<button data-ai-ref=\"new-ref\">FAQ</button>",
    capturedAt: "2026-07-28T00:00:01.000Z",
    domVersion: 2,
    pageInfo: { ...baseSnapshot.pageInfo, scrollY: 1 },
  };
  assert.equal(semanticSnapshotSignature(refreshed), semanticSnapshotSignature(baseSnapshot));
});

test("semantic comparison notices newly rendered visual surfaces", () => {
  const rendered = {
    ...baseSnapshot,
    visualSignals: { imageCount: 1, largeImageCount: 1, canvasCount: 0, videoCount: 0 },
  };
  assert.notEqual(semanticSnapshotSignature(rendered), semanticSnapshotSignature(baseSnapshot));
});

test("waits for changed page semantics to become quiet before returning fresh refs", async () => {
  let time = 0;
  let reads = 0;
  const ready = {
    ...baseSnapshot,
    snapshotId: "snapshot-ready",
    headings: [{ level: 1, text: "BTC Mining Products" }],
    mainText: "BTC Mining Products Buy BTC",
    elements: [btcButton],
    domVersion: 4,
  };
  const result = await waitForPageDecisionReadiness(
    baseSnapshot,
    async () => {
      reads += 1;
      return reads === 1 ? baseSnapshot : ready;
    },
    {
      timeoutMs: 2_000,
      pollIntervalMs: 250,
      quietWindowMs: 500,
      now: () => time,
      wait: async (delayMs) => { time += delayMs; },
    },
  );
  assert.equal(result?.snapshotId, "snapshot-ready");
  assert.ok(reads >= 4);
});

test("aria busy and progress indicators delay an early decision", async () => {
  let time = 0;
  let reads = 0;
  const busyElement = { ...btcButton, role: "progressbar", busy: true, fingerprint: "loading" };
  const busy = {
    ...baseSnapshot,
    snapshotId: "snapshot-busy",
    mainText: "Loading products",
    elements: [busyElement],
  };
  const ready = {
    ...busy,
    snapshotId: "snapshot-ready",
    mainText: "BTC Mining Products Buy BTC",
    elements: [btcButton],
  };
  const result = await waitForPageDecisionReadiness(
    baseSnapshot,
    async () => {
      reads += 1;
      return reads < 4 ? busy : ready;
    },
    {
      timeoutMs: 2_000,
      pollIntervalMs: 250,
      quietWindowMs: 250,
      now: () => time,
      wait: async (delayMs) => { time += delayMs; },
    },
  );
  assert.equal(hasVisibleBusyState(busy), true);
  assert.equal(result?.snapshotId, "snapshot-ready");
  assert.ok(reads >= 5);
});

test("explicit observe times out instead of continuing from a still-busy changed state", async () => {
  let time = 0;
  const busy = {
    ...baseSnapshot,
    snapshotId: "snapshot-busy",
    mainText: "Packaging",
    elements: [{ ...btcButton, role: "progressbar", busy: true }],
  };
  const result = await waitForPageDecisionReadiness(
    baseSnapshot,
    async () => busy,
    {
      timeoutMs: 1_000,
      pollIntervalMs: 250,
      requireStable: true,
      now: () => time,
      wait: async (delayMs) => { time += delayMs; },
    },
  );
  assert.equal(result, undefined);
});

test("returns no recovery snapshot when the blocked page never changes", async () => {
  let time = 0;
  const result = await waitForPageDecisionReadiness(
    baseSnapshot,
    async () => ({ ...baseSnapshot, snapshotId: crypto.randomUUID(), domVersion: baseSnapshot.domVersion + 1 }),
    {
      timeoutMs: 1_000,
      pollIntervalMs: 250,
      now: () => time,
      wait: async (delayMs) => { time += delayMs; },
    },
  );
  assert.equal(result, undefined);
});

test("observe timeout is capped and cannot exceed the remaining global budget", () => {
  assert.equal(boundedObserveTimeout(90_000, 120_000), 30_000);
  assert.equal(boundedObserveTimeout(20_000, 5_000), 5_000);
  assert.equal(boundedObserveTimeout(undefined, 20_000), 10_000);
  assert.equal(boundedObserveTimeout(10_000, 0), 0);
});

test("allows one blocked recovery per executed action boundary", () => {
  const loop = {
    runId: "run-1",
    iteration: 3,
    maxSteps: 50,
    timeoutMs: 30 * 60_000,
    startedAt: 0,
    lastAction: { action: "click", targetRef: "pay", reason: "Pay" },
    reobserve: {
      reason: "page_url_changed",
      summary: "Navigated",
      actionMayHaveExecuted: true,
    },
  } satisfies AgentLoopContext;
  assert.equal(getBlockedRecoveryBoundary(loop), "3:click");
  assert.equal(getBlockedRecoveryBoundary({
    ...loop,
    reobserve: { ...loop.reobserve, reason: "page_content_changed" },
  }), "3:click");
  assert.equal(getBlockedRecoveryBoundary({ ...loop, iteration: 4 }), "4:click");
});
