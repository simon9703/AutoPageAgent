import type { AgentEvent, AgentLoopContext, ChatMessage, SkillSelection } from "@auto-page-agent/shared";

export interface AgentRunContext {
  conversationId: string;
  history: ChatMessage[];
  loop?: AgentLoopContext;
  signal?: AbortSignal;
  selectedSkills?: SkillSelection[];
}

export type AgentEventSink = (event: AgentEvent) => void;
