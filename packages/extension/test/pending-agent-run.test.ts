import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage } from "@auto-page-agent/shared";
import { PendingAgentRunStore, type SessionStorageArea } from "../src/background/pending-agent-run.js";

class FakeSessionStorage implements SessionStorageArea {
  readonly values: Record<string, unknown> = {};

  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    for (const key of Array.isArray(keys) ? keys : [keys]) result[key] = this.values[key];
    return result;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete this.values[key];
  }
}

const history: ChatMessage[] = [{
  id: "message-1",
  role: "user",
  content: "Submit the form",
  createdAt: "2026-07-23T00:00:00.000Z",
}];

test("restores a planned task after the background worker restarts", async () => {
  const storage = new FakeSessionStorage();
  const firstWorker = new PendingAgentRunStore(storage);
  await firstWorker.save({
    task: "Submit the form",
    conversationId: "conversation-1",
    history,
    snapshotId: "snapshot-1",
    tabId: 17,
    windowId: 3,
    pageUrl: "https://example.com/form",
  });

  const restartedWorker = new PendingAgentRunStore(storage);
  const restored = await restartedWorker.loadForPlan("snapshot-1");

  assert.equal(restored.task, "Submit the form");
  assert.equal(restored.conversationId, "conversation-1");
  assert.equal(restored.tabId, 17);
  assert.equal(restored.windowId, 3);
  assert.equal(restored.pageUrl, "https://example.com/form");
  assert.deepEqual(restored.history, history);
});

test("rejects a plan whose snapshot does not match the persisted task", async () => {
  const storage = new FakeSessionStorage();
  const store = new PendingAgentRunStore(storage);
  await store.save({
    task: "Submit the form",
    conversationId: "conversation-1",
    history,
    snapshotId: "snapshot-1",
    tabId: 17,
    windowId: 3,
    pageUrl: "https://example.com/form",
  });

  await assert.rejects(
    new PendingAgentRunStore(storage).loadForPlan("snapshot-old"),
    /action plan is stale/iu,
  );
});

test("an old run cannot clear a newer pending task", async () => {
  const storage = new FakeSessionStorage();
  const store = new PendingAgentRunStore(storage);
  await store.save({
    task: "Old task",
    conversationId: "conversation-1",
    history,
    snapshotId: "snapshot-old",
    tabId: 17,
    windowId: 3,
    pageUrl: "https://example.com/form",
  });
  await store.save({
    task: "New task",
    conversationId: "conversation-1",
    history,
    snapshotId: "snapshot-new",
    tabId: 22,
    windowId: 3,
    pageUrl: "https://example.com/next",
  });

  await store.clearForSnapshot("snapshot-old");

  const restored = await new PendingAgentRunStore(storage).loadForPlan("snapshot-new");
  assert.equal(restored.task, "New task");
  assert.equal(restored.tabId, 22);
});

test("conversation reset clears only the matching pending task", async () => {
  const storage = new FakeSessionStorage();
  const store = new PendingAgentRunStore(storage);
  await store.save({
    task: "Keep this task",
    conversationId: "conversation-new",
    history,
    snapshotId: "snapshot-new",
    tabId: 17,
    windowId: 3,
    pageUrl: "https://example.com/form",
  });

  await store.clearForConversation("conversation-old");

  const restored = await new PendingAgentRunStore(storage).loadForPlan("snapshot-new");
  assert.equal(restored.conversationId, "conversation-new");
});

test("rejects legacy pending runs without a bound target tab", async () => {
  const storage = new FakeSessionStorage();
  storage.values.pendingAgentRun = {
    task: "Submit the form",
    conversationId: "conversation-1",
    history,
    snapshotId: "snapshot-1",
  };

  await assert.rejects(
    new PendingAgentRunStore(storage).loadForPlan("snapshot-1"),
    /original agent task expired/iu,
  );
});
