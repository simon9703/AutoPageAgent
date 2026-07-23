import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage, InspectedElement } from "@auto-page-agent/shared";
import {
  completedConversationMessage,
  composeAgentTask,
  conversationStorageKey,
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

test("conversation sessions retain one bound tab and pending task", () => {
  assert.deepEqual(normalizeConversationSession({
    conversationId: "conversation-1",
    messages: [],
    targetTabId: 17,
    pendingTask: "Choose an account",
  }), {
    conversationId: "conversation-1",
    messages: [],
    targetTabId: 17,
    pendingTask: "Choose an account",
  });
  assert.equal(normalizeConversationSession({ messages: [] }), null);
});

test("legacy global conversation state migrates into a window session", () => {
  assert.deepEqual(legacyConversationSession({
    conversationId: "conversation-old",
    chatMessages: [],
    conversationTargetTabId: 8,
    pendingConversationTask: "Continue",
  }), {
    conversationId: "conversation-old",
    messages: [],
    targetTabId: 8,
    pendingTask: "Continue",
  });
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
  assert.equal(completedConversationMessage("Invoice downloaded."), "Invoice downloaded.");
  assert.equal(completedConversationMessage("  "), "Task completed.");
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
