import type { ChatMessage, ChatMessageAttachment, InspectedElement } from "@auto-page-agent/shared";

export const LEGACY_CONVERSATION_STORAGE_KEYS = [
  "conversationId",
  "chatMessages",
  "conversationTargetTabId",
  "pendingConversationTask",
] as const;

export interface ConversationSession {
  conversationId: string;
  messages: ChatMessage[];
  targetTabId?: number;
  pendingTask?: string;
}

interface SelectedMessageContext {
  element: InspectedElement;
  pageUrl: string;
  screenshot?: { dataUrl: string; title: string; url: string };
}

interface ScreenshotMessageContext {
  dataUrl: string;
  title: string;
  url: string;
}

export function conversationStorageKey(windowId: number): string {
  return `conversationSession:${windowId}`;
}

export function normalizeConversationSession(value: unknown): ConversationSession | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ConversationSession>;
  if (typeof candidate.conversationId !== "string" || !candidate.conversationId) return null;
  return {
    conversationId: candidate.conversationId,
    messages: Array.isArray(candidate.messages) ? candidate.messages.slice(-40) : [],
    ...(typeof candidate.targetTabId === "number" ? { targetTabId: candidate.targetTabId } : {}),
    ...(typeof candidate.pendingTask === "string" && candidate.pendingTask.trim()
      ? { pendingTask: candidate.pendingTask }
      : {}),
  };
}

export function legacyConversationSession(value: Record<string, unknown>): ConversationSession | null {
  if (typeof value.conversationId !== "string" || !value.conversationId) return null;
  return normalizeConversationSession({
    conversationId: value.conversationId,
    messages: value.chatMessages,
    targetTabId: value.conversationTargetTabId,
    pendingTask: value.pendingConversationTask,
  });
}

export function composeAgentTask(userInput: string, pendingTask?: string | null): string {
  const input = userInput.trim();
  const originalTask = pendingTask?.trim();
  if (!originalTask) return input;
  return `${originalTask}\n\nUser follow-up:\n${input}`;
}

export function completedConversationMessage(answer?: string): string {
  return answer?.trim() || "Task completed.";
}

export function summarizeMessageContext(
  selected: SelectedMessageContext | null,
  screenshot: ScreenshotMessageContext | null,
): ChatMessageAttachment[] | undefined {
  const attachments: ChatMessageAttachment[] = [];
  if (selected) {
    attachments.push({
      kind: "element",
      tagName: selected.element.tagName,
      label: selected.element.label || selected.element.text || selected.element.nearbyText || "No visible text",
      pageUrl: selected.pageUrl,
      captured: Boolean(selected.screenshot),
    });
  }
  if (screenshot) {
    attachments.push({
      kind: "screenshot",
      title: screenshot.title || "Current page",
      pageUrl: screenshot.url,
    });
  }
  return attachments.length ? attachments : undefined;
}

export function toAgentHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(({ id, role, content, createdAt }) => ({ id, role, content, createdAt }));
}
