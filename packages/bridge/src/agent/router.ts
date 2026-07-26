import type { AgentDecision, AgentEvent, AgentRuntimeStatus, CodexRuntimeStatus, PageSnapshot, SkillSelection } from "@auto-page-agent/shared";
import { loadSkills, selectSkillContext, skillMatchesPage } from "../skills.js";
import { CodexProvider } from "./providers/codex.js";
import { OpenAIResponsesProvider } from "./providers/openai.js";
import type { AgentEventSink, AgentRunContext } from "./types.js";

type EventWithoutMeta<T> = T extends unknown ? Omit<T, "id" | "timestamp"> : never;
type AgentEventInput = EventWithoutMeta<AgentEvent>;

export class AgentRouter {
  readonly codex = new CodexProvider();
  readonly openai: OpenAIResponsesProvider;

  constructor(openai = new OpenAIResponsesProvider()) { this.openai = openai; }

  reset(conversationId: string): void {
    this.codex.reset(conversationId);
    this.openai.reset(conversationId);
  }

  async status(codexStatus?: CodexRuntimeStatus): Promise<AgentRuntimeStatus> {
    const preference = normalizeProviderPreference(process.env.AUTO_PAGE_AGENT_PROVIDER);
    const local = codexStatus ?? await this.codex.status();
    const api = this.openai.status();
    if (preference === "openai") return api;
    if (preference === "codex") return toCodexAgentStatus(local);
    return local.available && local.authenticated ? toCodexAgentStatus(local) : api.available ? api : toCodexAgentStatus(local);
  }

  async run(
    task: string,
    snapshot: PageSnapshot,
    context: AgentRunContext,
    onEvent?: AgentEventSink,
  ): Promise<{ decision: AgentDecision; provider: string; selectedSkills: Omit<SkillSelection, "body">[] }> {
    const status = await this.status();
    if (!status.available || !status.authenticated) throw new Error(status.error || "No agent provider is available.");
    const loadedSkills = await loadSkills();
    const requested = context.selectedSkillSlug
      ? loadedSkills.find((skill) => skill.slug === context.selectedSkillSlug)
      : undefined;
    if (context.selectedSkillSlug && (!requested || requested.workflow?.enabled === false || (!context.loop && !skillMatchesPage(requested, snapshot.url)))) {
      throw new Error("The selected Skill is unavailable or does not match the current page.");
    }
    const selectedSkills = requested
      ? [{
          name: requested.name,
          slug: requested.slug,
          reason: "Explicitly selected by the user.",
          score: 100,
          scope: requested.workflow?.startUrl ? "page" as const : "global" as const,
          body: requested.body,
        }]
      : selectSkillContext(task, loadedSkills, snapshot.url);
    const providerContext = { ...context, selectedSkills };
    const decision = status.id === "openai"
      ? await this.openai.run(task, snapshot, providerContext, onEvent)
      : await this.codex.run(task, snapshot, providerContext, onEvent);
    if (decision.kind === "complete") emit(onEvent, { type: "complete", summary: decision.summary.slice(0, 240) });
    return { decision, provider: status.name, selectedSkills: selectedSkills.map(({ body: _body, ...skill }) => skill) };
  }
}

function emit(sink: AgentEventSink | undefined, event: AgentEventInput): void {
  sink?.({ ...event, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, timestamp: new Date().toISOString() } as AgentEvent);
}

function normalizeProviderPreference(value: string | undefined): "auto" | "codex" | "openai" {
  return value === "codex" || value === "openai" ? value : "auto";
}

function toCodexAgentStatus(status: CodexRuntimeStatus): AgentRuntimeStatus {
  return { id: "codex", name: "Local Codex", available: status.available, authenticated: status.authenticated, error: status.error };
}
