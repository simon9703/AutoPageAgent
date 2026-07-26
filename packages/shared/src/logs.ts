import type { AgentEvent } from "./agent-events.js";
import type { AgentNeedsUser } from "./agent.js";
import type { ChatMessage } from "./chat.js";

export interface ConversationLogTarget {
  tabId?: number;
  title: string;
  url: string;
}

export interface ConversationLog {
  schemaVersion: 1;
  conversationId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  windowId?: number;
  target: ConversationLogTarget;
  messages: ChatMessage[];
  events: AgentEvent[];
  pendingTask?: string;
  pendingChoice?: AgentNeedsUser;
  selectedSkill?: { slug: string; name: string };
}

export interface ConversationLogSummary {
  conversationId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  eventCount: number;
  target: ConversationLogTarget;
}
