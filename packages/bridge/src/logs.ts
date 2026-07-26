import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  AgentEvent,
  ChatMessage,
  ChatMessageAttachment,
  ConversationLog,
  ConversationLogSummary,
} from "@auto-page-agent/shared";
import { getDataSubdirectory } from "./data-paths.js";

const MAX_LOGS = 100;
const MAX_MESSAGES = 80;
const MAX_EVENTS = 160;
const MAX_TEXT = 4_000;
let mutationQueue = Promise.resolve();

export function getLogStoragePath(): string {
  return getDataSubdirectory("logs");
}

export async function listConversationLogs(root = getLogStoragePath()): Promise<ConversationLogSummary[]> {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const logs = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map(async (entry) => {
      try {
        return toSummary(normalizeConversationLog(JSON.parse(await readFile(resolve(root, entry.name), "utf8"))));
      } catch {
        return null;
      }
    }));
  return logs
    .filter((log): log is ConversationLogSummary => Boolean(log))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_LOGS);
}

export async function getConversationLog(
  conversationId: string,
  root = getLogStoragePath(),
): Promise<ConversationLog> {
  const safeId = validateConversationId(conversationId);
  try {
    return normalizeConversationLog(JSON.parse(await readFile(resolve(root, `${safeId}.json`), "utf8")));
  } catch {
    throw new Error("Conversation history was not found.");
  }
}

export async function saveConversationLog(
  input: ConversationLog,
  root = getLogStoragePath(),
): Promise<ConversationLogSummary> {
  const log = normalizeConversationLog(input);
  return mutate(async () => {
    await mkdir(root, { recursive: true });
    const path = resolve(root, `${log.conversationId}.json`);
    try {
      const current = normalizeConversationLog(JSON.parse(await readFile(path, "utf8")));
      if (current.revision > log.revision) return toSummary(current);
    } catch { /* First save for this conversation. */ }
    await writeFile(path, `${JSON.stringify(log, null, 2)}\n`, "utf8");
    return toSummary(log);
  });
}

export async function deleteConversationLog(
  conversationId: string,
  root = getLogStoragePath(),
): Promise<string> {
  const safeId = validateConversationId(conversationId);
  return mutate(async () => {
    await rm(resolve(root, `${safeId}.json`), { force: true });
    return safeId;
  });
}

function normalizeConversationLog(value: unknown): ConversationLog {
  if (!value || typeof value !== "object") throw new Error("Invalid conversation history.");
  const input = value as Partial<ConversationLog>;
  const conversationId = validateConversationId(input.conversationId);
  const createdAt = normalizeTimestamp(input.createdAt);
  const updatedAt = normalizeTimestamp(input.updatedAt);
  const target = input.target && typeof input.target === "object" ? input.target : { title: "", url: "" };
  const messages = Array.isArray(input.messages)
    ? input.messages.slice(-MAX_MESSAGES).map(normalizeMessage).filter((message): message is ChatMessage => Boolean(message))
    : [];
  const events = Array.isArray(input.events)
    ? input.events.slice(-MAX_EVENTS).map(normalizeEvent).filter((event): event is AgentEvent => Boolean(event))
    : [];
  return {
    schemaVersion: 1,
    conversationId,
    title: cleanText(input.title, 120) || deriveTitle(messages),
    createdAt,
    updatedAt,
    revision: Math.max(0, Math.floor(Number(input.revision) || 0)),
    ...(Number.isInteger(input.windowId) ? { windowId: input.windowId } : {}),
    target: {
      ...(Number.isInteger(target.tabId) ? { tabId: target.tabId } : {}),
      title: cleanText(target.title, 240),
      url: normalizeHttpUrl(target.url),
    },
    messages,
    events,
    ...(typeof input.pendingTask === "string" && input.pendingTask.trim()
      ? { pendingTask: cleanText(input.pendingTask, MAX_TEXT) }
      : {}),
    ...(normalizePendingChoice(input.pendingChoice) ? { pendingChoice: normalizePendingChoice(input.pendingChoice)! } : {}),
    ...(input.selectedSkill
      && typeof input.selectedSkill.slug === "string"
      && typeof input.selectedSkill.name === "string"
      ? { selectedSkill: { slug: cleanText(input.selectedSkill.slug, 100), name: cleanText(input.selectedSkill.name, 120) } }
      : {}),
  };
}

function normalizeMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<ChatMessage>;
  if (input.role !== "user" && input.role !== "assistant") return null;
  if (typeof input.id !== "string" || typeof input.content !== "string") return null;
  return {
    id: cleanText(input.id, 120),
    role: input.role,
    content: cleanText(input.content, MAX_TEXT),
    createdAt: normalizeTimestamp(input.createdAt),
    ...(Array.isArray(input.attachments)
      ? {
          attachments: input.attachments
            .slice(0, 4)
            .map(normalizeAttachment)
            .filter((attachment): attachment is ChatMessageAttachment => Boolean(attachment)),
        }
      : {}),
  };
}

function normalizeAttachment(value: unknown): ChatMessageAttachment | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<ChatMessageAttachment>;
  if (input.kind === "element") {
    return {
      kind: "element",
      tagName: cleanText(input.tagName, 80),
      label: cleanText(input.label, 500),
      pageUrl: normalizeHttpUrl(input.pageUrl),
      captured: Boolean(input.captured),
    };
  }
  if (input.kind === "screenshot") {
    return {
      kind: "screenshot",
      title: cleanText(input.title, 240),
      pageUrl: normalizeHttpUrl(input.pageUrl),
    };
  }
  return null;
}

function normalizePendingChoice(value: unknown): ConversationLog["pendingChoice"] | null {
  if (!value || typeof value !== "object") return null;
  const input = value as NonNullable<ConversationLog["pendingChoice"]>;
  if (input.kind !== "needs_user" || typeof input.question !== "string") return null;
  const options = Array.isArray(input.options)
    ? input.options.filter((option): option is string => typeof option === "string").slice(0, 5).map((option) => cleanText(option, 500))
    : [];
  return {
    kind: "needs_user",
    question: cleanText(input.question, 1_000),
    ...(options.length ? { options } : {}),
    ...(typeof input.recommendedOption === "string" && options.includes(input.recommendedOption)
      ? { recommendedOption: input.recommendedOption }
      : {}),
  };
}

function normalizeEvent(value: unknown): AgentEvent | null {
  if (!value || typeof value !== "object") return null;
  const input = value as AgentEvent;
  if (!["action", "verify", "complete", "error"].includes(input.type)) return null;
  const base = {
    id: cleanText(input.id, 120),
    timestamp: normalizeTimestamp(input.timestamp),
  };
  if (input.type === "action") {
    return {
      ...base,
      type: "action",
      action: cleanText(input.action, 80),
      status: input.status,
      ...(Number.isInteger(input.step) ? { step: input.step } : {}),
      ...(input.detail ? { detail: cleanText(input.detail, 500) } : {}),
    };
  }
  if (input.type === "verify") {
    return {
      ...base,
      type: "verify",
      success: Boolean(input.success),
      summary: cleanText(input.summary, 1_000),
      ...(Number.isInteger(input.step) ? { step: input.step } : {}),
      ...(Array.isArray(input.changes) ? { changes: input.changes.slice(0, 20).map((item) => cleanText(item, 300)) } : {}),
    };
  }
  if (input.type === "complete") {
    return { ...base, type: "complete", summary: cleanText(input.summary, 1_000) };
  }
  return {
    ...base,
    type: "error",
    error: cleanText(input.error, 1_000),
    ...(typeof input.recoverable === "boolean" ? { recoverable: input.recoverable } : {}),
  };
}

function toSummary(log: ConversationLog): ConversationLogSummary {
  return {
    conversationId: log.conversationId,
    title: log.title,
    createdAt: log.createdAt,
    updatedAt: log.updatedAt,
    messageCount: log.messages.length,
    eventCount: log.events.length,
    target: log.target,
  };
}

function deriveTitle(messages: ChatMessage[]): string {
  return cleanText(messages.find((message) => message.role === "user")?.content, 60) || "新对话";
}

function validateConversationId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/u.test(value)) {
    throw new Error("Invalid conversation id.");
  }
  return value;
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return new Date().toISOString();
}

function normalizeHttpUrl(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString().slice(0, 2_000) : "";
  } catch {
    return "";
  }
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.replace(/\0/gu, "").trim().slice(0, maxLength) : "";
}

function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(operation, operation);
  mutationQueue = next.then(() => undefined, () => undefined);
  return next;
}
