import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classifyReobserveError,
  consumeReobserveStep,
} from "../src/background/reobserve.js";

test("classifies stale page validation as reobserve without consuming an action", () => {
  for (const message of [
    "Page URL changed after the snapshot. Read the page again.",
    "Page snapshot expired. Read the page again.",
  ]) {
    const signal = classifyReobserveError(new Error(message));
    assert.ok(signal);
    assert.equal(signal.actionMayHaveExecuted, false);
    assert.equal(consumeReobserveStep(3, signal), 3);
  }
});

test("classifies replaced page contexts as reobserve without a verification failure", () => {
  for (const message of [
    "A listener indicated an asynchronous response, but the message port closed before a response was received",
    "Extension context invalidated.",
    "The frame was removed.",
    "No frame with id 4 in tab 12.",
  ]) {
    const signal = classifyReobserveError(new Error(message));
    assert.ok(signal);
    assert.equal(signal.reason, "page_context_invalidated");
    assert.equal(signal.actionMayHaveExecuted, true);
    assert.equal(consumeReobserveStep(3, signal), 4);
  }
});

test("unrelated action errors still fail closed", () => {
  assert.equal(classifyReobserveError(new Error("Target is disabled.")), undefined);
});

test("agent loop replans with a fresh snapshot before continuing", async () => {
  const background = await readFile(new URL("../src/background.ts", import.meta.url), "utf8");

  assert.match(background, /outcome\.kind === "reobserve"/u);
  assert.match(background, /outcome\.kind === "reobserve"\) \{\s*failures = 0;/u);
  assert.match(background, /snapshot: await reobservePage\(tabId\)/u);
  assert.match(background, /requestContinuation\(outcome\.snapshot, loop/u);
  assert.match(background, /plan = decision;\s*continue;/u);
  assert.doesNotMatch(background, /The page navigated; the new page must be checked[\s\S]+failures \+= 1/u);
});
