import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage, InspectedElement } from "@auto-page-agent/shared";
import {
  completedConversationMessage,
  composeAgentTask,
  createConversationLog,
  conversationStorageKey,
  defaultChoice,
  legacyConversationSession,
  normalizeConversationSession,
  summarizeMessageContext,
  toAgentHistory,
} from "../src/sidepanel/conversation.js";

test("conversation storage is isolated by browser window", () => {
  assert.equal(conversationStorageKey(4), "conversationSession:4");
  assert.equal(conversationStorageKey(9), "conversationSession:9");
  assert.notEqual(conversationStorageKey(4), conversationStorageKey(9));
});

test("conversation sessions retain one bound tab, pending task, and confirmable choice", () => {
  assert.deepEqual(normalizeConversationSession({
    conversationId: "conversation-1",
    messages: [],
    events: [],
    createdAt: "2026-07-26T08:00:00.000Z",
    revision: 7,
    targetTabId: 17,
    pendingTask: "Choose an account",
    pendingChoice: {
      kind: "needs_user",
      question: "Which account?",
      options: ["Personal", "Business"],
      recommendedOption: "Business",
    },
    selectedSkill: { slug: "invoice-download", name: "Invoice download" },
  }), {
    conversationId: "conversation-1",
    messages: [],
    events: [],
    createdAt: "2026-07-26T08:00:00.000Z",
    revision: 7,
    targetTabId: 17,
    pendingTask: "Choose an account",
    pendingChoice: {
      kind: "needs_user",
      question: "Which account?",
      options: ["Personal", "Business"],
      recommendedOption: "Business",
    },
    selectedSkill: { slug: "invoice-download", name: "Invoice download" },
  });
  assert.equal(normalizeConversationSession({ messages: [] }), null);
});

test("choice confirmation defaults to the recommendation or first option", () => {
  assert.equal(defaultChoice({
    kind: "needs_user",
    question: "Which account?",
    options: ["Personal", "Business"],
    recommendedOption: "Business",
  }), "Business");
  assert.equal(defaultChoice({
    kind: "needs_user",
    question: "Which account?",
    options: ["Personal", "Business"],
  }), "Personal");
});

test("legacy global conversation state migrates into a window session", () => {
  const session = legacyConversationSession({
    conversationId: "conversation-old",
    chatMessages: [],
    conversationTargetTabId: 8,
    pendingConversationTask: "Continue",
  });
  assert.equal(session?.conversationId, "conversation-old");
  assert.deepEqual(session?.messages, []);
  assert.deepEqual(session?.events, []);
  assert.equal(session?.revision, 0);
  assert.equal(session?.targetTabId, 8);
  assert.equal(session?.pendingTask, "Continue");
  assert.ok(Number.isFinite(Date.parse(session?.createdAt ?? "")));
});

test("durable logs contain compact conversation and operation history", () => {
  const log = createConversationLog({
    conversationId: "conversation-old",
    messages: [{
      id: "message-1",
      role: "user",
      content: "Analyze this page",
      createdAt: "2026-07-26T08:00:00.000Z",
    }],
    events: [{
      id: "event-1",
      type: "verify",
      success: true,
      summary: "Page changed",
      timestamp: "2026-07-26T08:01:00.000Z",
    }],
    createdAt: "2026-07-26T08:00:00.000Z",
    revision: 2,
    windowId: 3,
    target: { tabId: 8, windowId: 3, title: "Example", url: "https://example.com" },
    fallbackTitle: "New conversation",
  });
  assert.equal(log.title, "Analyze this page");
  assert.equal(log.target.tabId, 8);
  assert.equal(log.messages.length, 1);
  assert.equal(log.events.length, 1);
});

test("a user reply resumes the task that requested more information", () => {
  assert.equal(
    composeAgentTask("Use my personal account", "Open the billing page and download the invoice"),
    "Open the billing page and download the invoice\n\nUser follow-up:\nUse my personal account",
  );
});

test("ordinary messages remain standalone tasks", () => {
  assert.equal(composeAgentTask("Summarize this page", null), "Summarize this page");
});

test("completed chat messages omit internal step metadata", () => {
  assert.equal(completedConversationMessage("Invoice downloaded.", "任务已完成。"), "Invoice downloaded.");
  assert.equal(completedConversationMessage("  ", "任务已完成。"), "任务已完成。");
});

test("selected elements and screenshots become compact message summaries", () => {
  const element = {
    tagName: "button",
    label: "Publish report",
  } as InspectedElement;
  assert.deepEqual(
    summarizeMessageContext(
      { element, pageUrl: "https://example.com/reports", screenshot: { dataUrl: "data:image/jpeg;base64,large", title: "Publish report", url: "https://example.com/reports" } },
      { dataUrl: "data:image/jpeg;base64,large", title: "Reports", url: "https://example.com/reports" },
      { noVisibleText: "没有可见文本", currentPage: "当前页面" },
    ),
    [
      { kind: "element", tagName: "button", label: "Publish report", pageUrl: "https://example.com/reports", captured: true },
      { kind: "screenshot", title: "Reports", pageUrl: "https://example.com/reports" },
    ],
  );
});

test("agent history strips retained UI attachment summaries", () => {
  const messages: ChatMessage[] = [{
    id: "message-1",
    role: "user",
    content: "Explain this button",
    createdAt: "2026-07-23T12:00:00.000Z",
    attachments: [{ kind: "element", tagName: "button", label: "Publish", pageUrl: "https://example.com", captured: false }],
  }];
  assert.deepEqual(toAgentHistory(messages), [{
    id: "message-1",
    role: "user",
    content: "Explain this button",
    createdAt: "2026-07-23T12:00:00.000Z",
  }]);
});
