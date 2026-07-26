import assert from "node:assert/strict";
import test from "node:test";
import {
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
  for (const selector of ['[role="combobox"]', '[role="option"]', "[aria-controls]", "[aria-expanded]", "[aria-selected]"]) {
    assert.match(SNAPSHOT_CANDIDATE_SELECTOR, new RegExp(selector.replaceAll("[", "\\[").replaceAll("]", "\\]"), "u"));
  }
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
