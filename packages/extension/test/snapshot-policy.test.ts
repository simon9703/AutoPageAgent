import assert from "node:assert/strict";
import test from "node:test";
import {
  getSnapshotCandidatePriority,
  parseAriaIdRefs,
  resolveSnapshotRole,
  shouldIncludeSnapshotCandidate,
  SNAPSHOT_CANDIDATE_SELECTOR,
} from "../src/content/snapshot-policy.js";

const available = {
  visible: true,
  nearViewport: true,
  hiddenInput: false,
  topLayer: true,
  disabled: false,
  readonly: false,
};

test("snapshot selector covers combobox and dynamic option semantics", () => {
  for (const selector of ['[role="combobox"]', '[role="listbox"]', '[role="option"]', "[aria-controls]", "[aria-expanded]", "[aria-selected]"]) {
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

test("hidden, zero-size, covered, disabled, and readonly candidates are excluded", () => {
  assert.equal(shouldIncludeSnapshotCandidate({ ...available, visible: false }), false);
  assert.equal(shouldIncludeSnapshotCandidate({ ...available, topLayer: false }), false);
  assert.equal(shouldIncludeSnapshotCandidate({ ...available, disabled: true }), false);
  assert.equal(shouldIncludeSnapshotCandidate({ ...available, readonly: true }), false);
  assert.equal(shouldIncludeSnapshotCandidate(available), true);
});

test("aria-selected fallback receives option semantics without overriding an explicit role", () => {
  assert.equal(resolveSnapshotRole(null, "", true), "option");
  assert.equal(resolveSnapshotRole("tab", "", true), "tab");
  assert.equal(resolveSnapshotRole(null, "combobox", false), "combobox");
});
