import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserActionStep, PageElementSnapshot, PageSnapshot, PageSnapshotDiff } from "@auto-page-agent/shared";
import { getActionSettlePolicy, getDelayedActionObservationPolicy } from "../src/content/action-settle.js";
import {
  getPageTransitionState,
  hasObservableActionEffect,
  hasVerifiedDismissal,
  hasVerifiedOptionSelection,
} from "../src/content/action-verification.js";

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

test("click verification accepts an exact URL change", () => {
  const after = { ...snapshot, snapshotId: "snapshot-2", url: "https://example.com/saved" };
  const diff = { ...noDiff, urlChanged: true, summary: ["URL changed"] };
  assert.equal(hasObservableActionEffect(click, snapshot, after, diff), true);
});

test("click verification rejects an unrelated DOM mutation", () => {
  const diff = { ...noDiff, addedFingerprints: ["other-1"], summary: ["1 interactive element added"] };
  assert.equal(hasObservableActionEffect(click, snapshot, snapshot, diff, "save-1"), false);
});

test("click verification accepts target state changes and semantic result regions", () => {
  assert.equal(hasObservableActionEffect(click, snapshot, snapshot, {
    ...noDiff,
    changedFingerprints: ["save-1"],
    summary: ["1 element state changed"],
  }, "save-1"), true);
  const after = {
    ...snapshot,
    elements: [{ ...option, role: "status", fingerprint: "saved-status-1" }],
  };
  assert.equal(hasObservableActionEffect(click, snapshot, after, {
    ...noDiff,
    addedFingerprints: ["saved-status-1"],
    summary: ["1 interactive element added"],
  }, "save-1"), true);
});

test("click verification rejects an empty offscreen status as result evidence", () => {
  const emptyRouteStatus: PageElementSnapshot = {
    ...option,
    ref: "route-status",
    role: "status",
    label: "",
    text: "",
    value: "",
    fingerprint: "route-status-1",
    inViewport: false,
    occluded: true,
    viewportRect: { x: -9_999, y: -9_999, width: 1, height: 1 },
  };
  const after = { ...snapshot, elements: [emptyRouteStatus] };
  const diff = {
    ...noDiff,
    addedFingerprints: ["route-status-1"],
    summary: ["1 interactive element added"],
  };

  assert.equal(hasObservableActionEffect(click, snapshot, after, diff, "save-1"), false);
  assert.equal(getPageTransitionState(snapshot, after, diff), "pending");
});

test("delayed SPA navigation completes only after the destination context appears", () => {
  const emptyRouteStatus: PageElementSnapshot = {
    ...option,
    ref: "route-status",
    role: "status",
    label: "",
    text: "",
    value: "",
    fingerprint: "route-status-1",
    inViewport: false,
    occluded: true,
    viewportRect: { x: -9_999, y: -9_999, width: 1, height: 1 },
  };
  const transition = {
    ...snapshot,
    snapshotId: "snapshot-2",
    elements: [emptyRouteStatus],
  };
  const transitionDiff = {
    ...noDiff,
    addedFingerprints: ["route-status-1"],
    summary: ["1 interactive element added"],
  };
  assert.equal(getPageTransitionState(snapshot, transition, transitionDiff), "pending");

  const destination = {
    ...snapshot,
    snapshotId: "snapshot-3",
    url: "https://example.com/mining/btc",
    title: "BTC Mining",
    headings: [{ level: 1, text: "BTC Mining Products" }],
    mainText: "BTC Mining Products Quantity Submit order",
  };
  const destinationDiff = {
    ...noDiff,
    urlChanged: true,
    titleChanged: true,
    removedFingerprints: ["save-1"],
    summary: ["URL changed to https://example.com/mining/btc", "Page title changed"],
  };
  assert.equal(getPageTransitionState(snapshot, destination, destinationDiff), "completed");
});

test("a URL change stays pending until destination-page context is visible", () => {
  const destinationPending = {
    ...snapshot,
    snapshotId: "snapshot-2",
    url: "https://example.com/mining/btc",
  };
  assert.equal(getPageTransitionState(snapshot, destinationPending, {
    ...noDiff,
    urlChanged: true,
    summary: ["URL changed"],
  }), "pending");
});

test("ordinary DOM changes are not mistaken for a route transition", () => {
  assert.equal(getPageTransitionState(snapshot, snapshot, noDiff), "none");
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
  assert.deepEqual(getActionSettlePolicy("click", { comboboxClick: true }), {
    minWaitMs: 250,
    maxWaitMs: 1_200,
    quietMs: 150,
    pollMs: 90,
    waitForOption: true,
  });
  assert.deepEqual(getActionSettlePolicy("focus"), { maxWaitMs: 160, quietMs: 80 });
  assert.deepEqual(getActionSettlePolicy("select"), { maxWaitMs: 900, quietMs: 180 });
  assert.deepEqual(getActionSettlePolicy("dismiss"), { maxWaitMs: 900, quietMs: 180 });
  assert.deepEqual(getActionSettlePolicy("scroll"), { maxWaitMs: 700, quietMs: 160 });
  assert.deepEqual(getActionSettlePolicy("click"), { maxWaitMs: 1_800, quietMs: 250 });
  assert.deepEqual(getActionSettlePolicy("submit"), { maxWaitMs: 1_800, quietMs: 250 });
});

test("click, submit, and dismiss receive a bounded delayed observation", () => {
  const expected = { maxWaitMs: 2_500, quietMs: 250, pollMs: 100 };
  assert.deepEqual(getDelayedActionObservationPolicy("click"), expected);
  assert.deepEqual(getDelayedActionObservationPolicy("submit"), expected);
  assert.deepEqual(getDelayedActionObservationPolicy("dismiss"), expected);
  assert.equal(getDelayedActionObservationPolicy("fill"), undefined);
  assert.equal(getDelayedActionObservationPolicy("select"), undefined);
  assert.equal(getDelayedActionObservationPolicy("focus"), undefined);
  assert.equal(getDelayedActionObservationPolicy("scroll"), undefined);
});

const combobox = (expanded: boolean, value = ""): PageElementSnapshot => ({
  ref: "project",
  tagName: "input",
  role: "combobox",
  label: "Project",
  text: "",
  selector: "#project",
  value,
  disabled: false,
  sensitive: false,
  contentEditable: false,
  fingerprint: "project-1",
  inViewport: true,
  occluded: false,
  readonly: false,
  expanded,
  controls: "project-list",
  viewportRect: { x: 0, y: 0, width: 200, height: 32 },
});

const option: PageElementSnapshot = {
  ref: "cloud-option",
  tagName: "div",
  role: "option",
  label: "kucoin-cloud-mining-rn",
  text: "kucoin-cloud-mining-rn",
  selector: "[title=kucoin-cloud-mining-rn]",
  disabled: false,
  sensitive: false,
  contentEditable: false,
  fingerprint: "cloud-option-1",
  inViewport: true,
  occluded: false,
  readonly: false,
  selected: false,
  domId: "cloud-option",
  ownerId: "project-list",
  viewportRect: { x: 0, y: 40, width: 200, height: 32 },
};

test("option click verifies selected state, associated final value, or active descendant", () => {
  const before = { ...snapshot, elements: [combobox(true), option] };
  assert.equal(hasVerifiedOptionSelection(before, {
    ...snapshot,
    elements: [combobox(true), { ...option, selected: true }],
  }, option.fingerprint), true);
  assert.equal(hasVerifiedOptionSelection(before, {
    ...snapshot,
    elements: [combobox(false, option.label)],
  }, option.fingerprint), true);
  assert.equal(hasVerifiedOptionSelection(before, {
    ...snapshot,
    elements: [{ ...combobox(false, option.label), fingerprint: "project-with-value-1" }],
  }, option.fingerprint), true);
  assert.equal(hasVerifiedOptionSelection(before, {
    ...snapshot,
    elements: [{ ...combobox(true), activeDescendant: option.domId }],
  }, option.fingerprint), true);
  assert.equal(hasVerifiedOptionSelection(before, {
    ...snapshot,
    elements: [{
      ...combobox(false),
      displayValue: "kucoin-cloud-mining-rn",
      selectedValues: ["kucoin-cloud-mining-rn"],
    }],
  }, option.fingerprint), true);
});

test("option click rejects collapse without the selected value", () => {
  const before = { ...snapshot, elements: [combobox(true), option] };
  assert.equal(hasVerifiedOptionSelection(before, {
    ...snapshot,
    elements: [combobox(false)],
  }, option.fingerprint), false);
});

test("option click ignores unrelated combobox values and selected options", () => {
  const before = { ...snapshot, elements: [combobox(true), option] };
  const unrelatedCombobox = { ...combobox(false, option.label), fingerprint: "other-combobox-1", controls: "other-list" };
  const unrelatedOption = { ...option, fingerprint: "other-option-1", ownerId: "other-list", selected: true };
  assert.equal(hasVerifiedOptionSelection(before, {
    ...snapshot,
    elements: [combobox(true), unrelatedCombobox, unrelatedOption],
  }, option.fingerprint), false);
});

test("search text alone does not verify option selection", () => {
  const before = { ...snapshot, elements: [combobox(true, "cloud"), option] };
  const after = { ...snapshot, elements: [combobox(true, "cloud"), option] };
  assert.equal(hasVerifiedOptionSelection(before, after, option.fingerprint), false);
});

test("multi-select verification matches either selected display value", () => {
  const secondOption = {
    ...option,
    ref: "web-option",
    label: "kucoin-cloud-mining-web",
    text: "kucoin-cloud-mining-web",
    fingerprint: "web-option-1",
    domId: "web-option",
  };
  const before = { ...snapshot, elements: [combobox(true), option, secondOption] };
  const after = {
    ...snapshot,
    elements: [{
      ...combobox(false),
      displayValue: "kucoin-cloud-mining-rn, kucoin-cloud-mining-web",
      selectedValues: ["kucoin-cloud-mining-rn", "kucoin-cloud-mining-web"],
    }],
  };
  assert.equal(hasVerifiedOptionSelection(before, after, option.fingerprint), true);
  assert.equal(hasVerifiedOptionSelection(before, after, secondOption.fingerprint), true);
});

test("clicking an already selected option cannot verify as selection or dismissal", () => {
  const selectedOption = { ...option, selected: true };
  const before = { ...snapshot, elements: [combobox(true), selectedOption] };
  const collapsed = { ...snapshot, elements: [combobox(false), selectedOption] };
  assert.equal(hasVerifiedOptionSelection(before, collapsed, selectedOption.fingerprint), false);
});

test("dismiss verifies a combobox true-to-false transition", () => {
  const before = { ...snapshot, elements: [combobox(true)] };
  const after = { ...snapshot, elements: [combobox(false)] };
  assert.equal(hasVerifiedDismissal(before, after, "project-1"), true);
  assert.equal(hasVerifiedDismissal(before, before, "project-1"), false);
});

test("dismiss verifies disappearance of the combobox-controlled popup", () => {
  const listbox = {
    ...option,
    ref: "listbox",
    role: "listbox",
    fingerprint: "project-list-1",
    domId: "project-list",
    ownerId: undefined,
  };
  const before = { ...snapshot, elements: [combobox(true), listbox] };
  const after = { ...snapshot, elements: [combobox(true)] };
  assert.equal(hasVerifiedDismissal(before, after, "project-1"), true);
  assert.equal(hasVerifiedDismissal(before, before, "project-1"), false);
});

test("dismiss verifies popup removal while preserving the outer dialog", () => {
  const dialog = { ...option, ref: "dialog", role: "dialog", fingerprint: "dialog-1", domId: undefined, ownerId: undefined };
  const listbox = { ...option, ref: "listbox", role: "listbox", fingerprint: "project-list-1", domId: "project-list", ownerId: undefined };
  const before = { ...snapshot, elements: [dialog, listbox] };
  assert.equal(hasVerifiedDismissal(before, {
    ...snapshot,
    elements: [dialog],
  }, listbox.fingerprint), true);
  assert.equal(hasVerifiedDismissal(before, {
    ...snapshot,
    elements: [],
  }, listbox.fingerprint), false);
});

test("dismiss can verify popup removal from a selected option anchor", () => {
  const dialog = { ...option, ref: "dialog", role: "dialog", fingerprint: "dialog-1", domId: undefined, ownerId: undefined };
  const listbox = { ...option, ref: "listbox", role: "listbox", fingerprint: "site-list-1", domId: "site-list", ownerId: undefined };
  const selectedOption = { ...option, selected: true, ownerId: "site-list" };
  const before = { ...snapshot, elements: [dialog, listbox, selectedOption] };
  assert.equal(hasVerifiedDismissal(before, {
    ...snapshot,
    elements: [dialog],
  }, selectedOption.fingerprint), true);
  assert.equal(hasVerifiedDismissal(before, before, selectedOption.fingerprint), false);
});

test("Escape dispatch without a collapsed or hidden state is not dismissal success", () => {
  const before = { ...snapshot, elements: [combobox(true)] };
  assert.equal(hasVerifiedDismissal(before, { ...before, snapshotId: "snapshot-2" }, "project-1"), false);
});
