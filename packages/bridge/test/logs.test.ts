import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ConversationLog } from "@auto-page-agent/shared";
import {
  deleteConversationLog,
  getConversationLog,
  listConversationLogs,
  saveConversationLog,
} from "../src/logs.js";

function sampleLog(revision: number): ConversationLog {
  return {
    schemaVersion: 1,
    conversationId: "conversation_123",
    title: "发布测试订单",
    createdAt: "2026-07-26T08:00:00.000Z",
    updatedAt: `2026-07-26T08:0${revision}:00.000Z`,
    revision,
    windowId: 3,
    target: {
      tabId: 17,
      title: "测试商城",
      url: "https://example.com/orders/new",
    },
    messages: [{
      id: "message_123",
      role: "user",
      content: "填写并提交测试订单",
      createdAt: "2026-07-26T08:00:00.000Z",
    }],
    events: [{
      id: "event_123",
      type: "action",
      action: "click",
      targetRef: "stale-secret-ref",
      status: "success",
      detail: "点击提交按钮",
      timestamp: "2026-07-26T08:01:00.000Z",
    }],
  };
}

test("conversation logs persist messages and operation history beside durable user data", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-page-agent-logs-"));
  try {
    const summary = await saveConversationLog(sampleLog(1), root);
    assert.equal(summary.messageCount, 1);
    assert.equal(summary.eventCount, 1);
    const loaded = await getConversationLog("conversation_123", root);
    assert.equal(loaded.title, "发布测试订单");
    assert.equal(loaded.events[0]?.type, "action");
    assert.equal("targetRef" in loaded.events[0]!, false);
    assert.deepEqual((await listConversationLogs(root)).map((item) => item.conversationId), ["conversation_123"]);
    const file = await readFile(join(root, "conversation_123.json"), "utf8");
    assert.doesNotMatch(file, /stale-secret-ref/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("conversation logs reject stale writes and can be deleted", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-page-agent-logs-"));
  try {
    await saveConversationLog(sampleLog(2), root);
    const stale = await saveConversationLog({ ...sampleLog(1), title: "旧标题" }, root);
    assert.equal(stale.title, "发布测试订单");
    assert.equal((await getConversationLog("conversation_123", root)).revision, 2);
    assert.equal(await deleteConversationLog("conversation_123", root), "conversation_123");
    assert.equal((await listConversationLogs(root)).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("conversation log ids cannot escape the logs directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-page-agent-logs-"));
  try {
    await assert.rejects(() => getConversationLog("../registry", root), /Invalid conversation id/u);
    await assert.rejects(() => deleteConversationLog("../registry", root), /Invalid conversation id/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
