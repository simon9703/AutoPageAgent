import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserActionStep, PageSnapshot } from "@auto-page-agent/shared";
import {
  createPopupDismissStepAfterOptionSelection,
  rebindQueuedStep,
} from "../src/background/step-queue.js";

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

const selectedOption = {
  ...snapshot.elements[0]!,
  ref: "site-global",
  tagName: "div",
  role: "option",
  label: "global",
  text: "global",
  fingerprint: "site-global-1",
  selected: true,
  ownerId: "site-list",
};

const openSiteCombobox = {
  ...snapshot.elements[0]!,
  ref: "site-combobox",
  tagName: "input",
  role: "combobox",
  label: "Site",
  text: "",
  fingerprint: "site-combobox-1",
  expanded: true,
  controls: "site-list",
  readonly: true,
};

test("verified option selection queues popup dismissal before the next field", () => {
  const dismiss = createPopupDismissStepAfterOptionSelection({
    action: "click",
    targetRef: "old-site-global",
    targetFingerprint: "site-global-1",
    reason: "Select global",
  }, [{
    action: "click",
    targetRef: "old-project-combobox",
    targetFingerprint: "project-combobox-1",
    reason: "Open projects",
  }], {
    ...snapshot,
    elements: [selectedOption, openSiteCombobox],
  });

  assert.deepEqual(dismiss, {
    action: "dismiss",
    targetRef: "site-combobox",
    targetFingerprint: "site-combobox-1",
    reason: "Close the selected dropdown before continuing with the next field.",
  });
});

test("verified option selection keeps another unselected option in the same popup first", () => {
  const nextOption = {
    ...selectedOption,
    ref: "site-thailand",
    label: "Thailand",
    text: "Thailand",
    fingerprint: "site-thailand-1",
    selected: false,
  };
  const dismiss = createPopupDismissStepAfterOptionSelection({
    action: "click",
    targetFingerprint: "site-global-1",
    reason: "Select global",
  }, [{
    action: "click",
    targetFingerprint: "site-thailand-1",
    reason: "Select Thailand",
  }], {
    ...snapshot,
    elements: [selectedOption, nextOption, openSiteCombobox],
  });

  assert.equal(dismiss, undefined);
});

test("verified option selection does not duplicate an explicit queued dismiss", () => {
  const dismiss = createPopupDismissStepAfterOptionSelection({
    action: "click",
    targetFingerprint: "site-global-1",
    reason: "Select global",
  }, [{
    action: "dismiss",
    targetFingerprint: "site-combobox-1",
    reason: "Close sites",
  }], {
    ...snapshot,
    elements: [selectedOption, openSiteCombobox],
  });

  assert.equal(dismiss, undefined);
});
