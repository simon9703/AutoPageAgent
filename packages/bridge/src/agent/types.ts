import type { AgentEvent, AgentLoopContext, ChatMessage, SkillSelection } from "@auto-page-agent/shared";

export interface AgentRunContext {
  conversationId: string;
  history: ChatMessage[];
  loop?: AgentLoopContext;
  signal?: AbortSignal;
  selectedSkills?: SkillSelection[];
  selectedSkillSlug?: string;
}

export type AgentEventSink = (event: AgentEvent) => void;
