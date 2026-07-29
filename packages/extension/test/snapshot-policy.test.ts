import assert from "node:assert/strict";
import test from "node:test";
import {
  getSnapshotCandidatePriority,
  parseAriaIdRefs,
  resolveCurrentState,
  resolveMultipleState,
  resolvePaginationRelation,
  resolveSnapshotRole,
  shouldIncludeSnapshotCandidate,
  SNAPSHOT_CANDIDATE_SELECTOR,
} from "../src/content/snapshot-policy.js";
import { buildSimplifiedDom } from "../src/content/dom.js";
import type { PageElementSnapshot } from "@auto-page-agent/shared";

const available = {
  visible: true,
  nearViewport: true,
  hiddenInput: false,
  topLayer: true,
  disabled: false,
  readonly: false,
};

test("snapshot selector covers combobox and dynamic option semantics", () => {
  for (const selector of ['[role="combobox"]', '[role="listbox"]', '[role="option"]', '[role="progressbar"]', "[aria-controls]", "[aria-expanded]", "[aria-selected]", '[aria-busy="true"]']) {
    assert.match(SNAPSHOT_CANDIDATE_SELECTOR, new RegExp(selector.replaceAll("[", "\\[").replaceAll("]", "\\]"), "u"));
  }
});

test("expanded controls and their popup content rank before viewport and nearby candidates", () => {
  const base = {
    expandedControl: false,
    relatedToExpandedControl: false,
    visiblePopup: false,
    inViewport: false,
    changedOrAdded: false,
    nearViewport: true,
  };
  assert.equal(getSnapshotCandidatePriority({ ...base, relatedToExpandedControl: true }), 0);
  assert.equal(getSnapshotCandidatePriority({ ...base, visiblePopup: true }), 1);
  assert.equal(getSnapshotCandidatePriority({ ...base, inViewport: true }), 2);
  assert.equal(getSnapshotCandidatePriority({ ...base, changedOrAdded: true }), 3);
  assert.equal(getSnapshotCandidatePriority(base), 4);
});

test("ARIA relations accept multiple whitespace-separated ids", () => {
  assert.deepEqual(parseAriaIdRefs(" project-list  project-help\n"), ["project-list", "project-help"]);
  assert.deepEqual(parseAriaIdRefs(null), []);
});

test("hidden and covered candidates are excluded while readonly and disabled pagination remain observable", () => {
  assert.equal(shouldIncludeSnapshotCandidate({ ...available, visible: false }), false);
  assert.equal(shouldIncludeSnapshotCandidate({ ...available, topLayer: false }), false);
  assert.equal(shouldIncludeSnapshotCandidate({ ...available, disabled: true }), true);
  assert.equal(shouldIncludeSnapshotCandidate({ ...available, readonly: true }), true);
  assert.equal(shouldIncludeSnapshotCandidate(available), true);
});

test("snapshot derives multiple, current, and pagination relation from standard DOM and ARIA semantics", () => {
  assert.equal(resolveMultipleState({ ariaMultiselectable: "true" }), true);
  assert.equal(resolveMultipleState({ multiple: true }), true);
  assert.equal(resolveCurrentState("page"), true);
  assert.equal(resolveCurrentState("false"), undefined);
  assert.equal(resolvePaginationRelation({ rel: "nofollow next" }), "next");
  assert.equal(resolvePaginationRelation({ ariaLabel: "Previous page", withinNavigation: true }), "previous");
  assert.equal(resolvePaginationRelation({ text: "Next", withinNavigation: false }), undefined);
});

test("aria-selected fallback receives option semantics without overriding an explicit role", () => {
  assert.equal(resolveSnapshotRole(null, "", true), "option");
  assert.equal(resolveSnapshotRole("tab", "", true), "tab");
  assert.equal(resolveSnapshotRole(null, "combobox", false), "combobox");
});

test("simplified DOM exposes readonly combobox state and selected display values", () => {
  const element: PageElementSnapshot = {
    ref: "site",
    tagName: "input",
    role: "combobox",
    label: "Site",
    text: "",
    selector: "#site",
    value: "",
    displayValue: "global",
    selectedValues: ["global", "cloud"],
    multiple: true,
    current: true,
    relation: "next",
    disabled: false,
    sensitive: false,
    contentEditable: false,
    fingerprint: "site-1",
    inViewport: true,
    occluded: false,
    readonly: true,
    expanded: false,
    controls: "site-list",
    layerId: "popup:site-list",
    parentLayerId: "dialog:package",
    scrollable: true,
    scrollPosition: { x: 0, y: 20, maxX: 0, maxY: 200 },
    viewportRect: { x: 0, y: 0, width: 200, height: 32 },
  };
  const simplified = buildSimplifiedDom([element], new Map());
  assert.match(simplified, /readonly/u);
  assert.match(simplified, /aria-expanded="false"/u);
  assert.match(simplified, /aria-controls="site-list"/u);
  assert.match(simplified, /data-display-value="global"/u);
  assert.match(simplified, /data-selected-values="global \| cloud"/u);
  assert.match(simplified, /aria-multiselectable="true"/u);
  assert.match(simplified, /aria-current="page"/u);
  assert.match(simplified, /rel="next"/u);
  assert.match(simplified, /data-ai-layer="popup:site-list"/u);
  assert.match(simplified, /data-ai-parent-layer="dialog:package"/u);
  assert.match(simplified, /data-scrollable="true"/u);
});
