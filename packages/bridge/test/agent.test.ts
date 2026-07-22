import assert from "node:assert/strict";
import test from "node:test";
import type { PageSnapshot } from "@auto-page-agent/shared";
import { extractJson, normalizeDecision } from "../src/agent.js";

const snapshot = {
  snapshotId: "snapshot-1", url: "https://example.com", title: "Example", language: "en", selectedText: "", headings: [], mainText: "",
  elements: [{ ref: "element-1", tagName: "button", role: "button", label: "Save", text: "Save", selector: "button", disabled: false, contentEditable: false, viewportRect: { x: 0, y: 0, width: 10, height: 10 } }],
  performance: { resources: [], summary: { requestCount: 0, totalTransferSize: 0, slowRequestCount: 0 } },
} satisfies PageSnapshot;

test("extractJson supports fenced model output", () => {
  assert.deepEqual(extractJson("```json\n{\"kind\":\"answer\",\"content\":\"ok\"}\n```"), { kind: "answer", content: "ok" });
});

test("normalizeDecision rejects invented element refs", () => {
  const result = normalizeDecision({ kind: "action_plan", steps: [{ action: "click", targetRef: "element-99" }] }, snapshot);
  assert.equal(result.kind, "answer");
});

test("normalizeDecision binds the current snapshot and requires confirmation", () => {
  const result = normalizeDecision({ kind: "action_plan", confidence: 0.9, steps: [{ action: "click", targetRef: "element-1" }] }, snapshot);
  assert.equal(result.kind, "action_plan");
  if (result.kind === "action_plan") {
    assert.equal(result.snapshotId, "snapshot-1");
    assert.equal(result.requiresConfirmation, true);
  }
});
