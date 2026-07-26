import type { AgentDecision, AgentLoopContext, AgentRuntimeStatus, CodexRuntimeStatus } from "./agent.js";
import type { AgentEvent } from "./agent-events.js";
import type { ApiRequestSnapshot, InspectedElement, PageSnapshot } from "./browser.js";
import type { ChatMessage } from "./chat.js";
import type { RepositoryAnalysis } from "./repositories.js";
import type {
  AutomationSkillDraft,
  ConfiguredAutomationSkill,
  EditableAutomationSkill,
  PageSkillSummary,
  SavedAutomationSkill,
  SkillCatalogItem,
  SkillSelection,
} from "./skills.js";

export type ClientMessage =
  | { id: string; type: "health.check" }
  | { id: string; type: "agent.reset"; conversationId: string }
  | { id: string; type: "agent.cancel"; requestId: string; conversationId: string }
  | { id: string; type: "agent.run"; task: string; snapshot: PageSnapshot; conversationId: string; history: ChatMessage[]; loop?: AgentLoopContext }
  | { id: string; type: "repository.analyze"; pageUrl: string; element: InspectedElement; apiRequests: ApiRequestSnapshot[] }
  | { id: string; type: "skill.list"; pageUrl: string; pageTitle: string }
  | { id: string; type: "skill.catalog" }
  | { id: string; type: "skill.get"; slug: string }
  | { id: string; type: "skill.install"; slug: string }
  | { id: string; type: "skill.configure"; slug: string; enabled?: boolean; pagePatterns?: string[] }
  | { id: string; type: "skill.save"; draft: AutomationSkillDraft; existingSlug?: string };

export type ServerMessage =
  | { id: string; type: "health.result"; ok: boolean; provider: string; repositories: string[]; codex: CodexRuntimeStatus; agent: AgentRuntimeStatus }
  | { id: string; type: "agent.reset.result"; conversationId: string }
  | { id: string; type: "agent.cancel.result"; requestId: string; cancelled: boolean }
  | { id: string; type: "agent.event"; event: AgentEvent }
  | { id: string; type: "agent.result"; decision: AgentDecision; provider: string; conversationId: string; selectedSkills: Omit<SkillSelection, "body">[] }
  | { id: string; type: "repository.result"; analysis: RepositoryAnalysis }
  | { id: string; type: "skill.list.result"; pageUrl: string; skills: PageSkillSummary[] }
  | { id: string; type: "skill.catalog.result"; installed: SkillCatalogItem[]; marketplace: SkillCatalogItem[]; storagePath: string }
  | { id: string; type: "skill.detail"; skill: EditableAutomationSkill }
  | { id: string; type: "skill.installed"; skill: SkillCatalogItem }
  | { id: string; type: "skill.configured"; skill: ConfiguredAutomationSkill }
  | { id: string; type: "skill.saved"; skill: SavedAutomationSkill }
  | { id: string; type: "agent.error"; error: string };
