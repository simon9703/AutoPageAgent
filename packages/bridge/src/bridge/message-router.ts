import type { ClientMessage, ServerMessage } from "@auto-page-agent/shared";
import { AgentRouter } from "../agent.js";
import { loadRepositoryRoots, LocalRepositoryProvider } from "../repositories.js";
import {
  configureAutomationSkill,
  deleteAutomationSkill,
  exportAutomationSkill,
  getEditableSkill,
  importAutomationSkill,
  installMarketplaceSkill,
  listSkillCatalog,
  listSkillsForPage,
  loadSkills,
  saveAutomationSkill,
} from "../skills.js";
import { summarizeSkill } from "../skills/summarize.js";
import {
  deleteConversationLog,
  getConversationLog,
  getLogStoragePath,
  listConversationLogs,
  saveConversationLog,
} from "../logs.js";

export type ServerMessageSink = (message: ServerMessage) => void;

export class BridgeMessageRouter {
  readonly provider: AgentRouter;
  readonly repositoryProvider: LocalRepositoryProvider;
  readonly #activeRuns = new Map<string, AbortController>();

  private constructor(provider: AgentRouter, repositoryProvider: LocalRepositoryProvider) {
    this.provider = provider;
    this.repositoryProvider = repositoryProvider;
  }

  static async create(): Promise<BridgeMessageRouter> {
    return new BridgeMessageRouter(
      new AgentRouter(),
      new LocalRepositoryProvider(await loadRepositoryRoots()),
    );
  }

  stop(): void {
    for (const controller of this.#activeRuns.values()) controller.abort();
    this.#activeRuns.clear();
  }

  async handle(raw: unknown, emit: ServerMessageSink): Promise<void> {
    let request: ClientMessage | undefined;
    try {
      request = validateClientMessage(raw);
      const response = await this.#route(request, emit);
      emit(response);
    } catch (error) {
      emit({
        id: request?.id ?? readRequestId(raw),
        type: "agent.error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async #route(request: ClientMessage, emit: ServerMessageSink): Promise<ServerMessage> {
    if (request.type === "health.check") {
      const codex = await this.provider.codex.status();
      const agent = await this.provider.status(codex);
      return {
        id: request.id,
        type: "health.result",
        ok: agent.available && agent.authenticated,
        provider: agent.name,
        repositories: this.repositoryProvider.roots.map((root) => root.name),
        codex,
        agent,
      };
    }
    if (request.type === "agent.reset") {
      this.provider.reset(request.conversationId);
      return { id: request.id, type: "agent.reset.result", conversationId: request.conversationId };
    }
    if (request.type === "agent.cancel") {
      const controller = this.#activeRuns.get(request.requestId);
      controller?.abort();
      return { id: request.id, type: "agent.cancel.result", requestId: request.requestId, cancelled: Boolean(controller) };
    }
    if (request.type === "agent.run") {
      const controller = new AbortController();
      this.#activeRuns.set(request.id, controller);
      try {
        const result = await this.provider.run(
          request.task,
          request.snapshot,
          {
            conversationId: request.conversationId,
            history: request.history,
            loop: request.loop,
            signal: controller.signal,
            selectedSkillSlug: request.selectedSkillSlug,
          },
          (event) => emit({ id: request.id, type: "agent.event", event }),
        );
        return {
          id: request.id,
          type: "agent.result",
          decision: result.decision,
          provider: result.provider,
          conversationId: request.conversationId,
          selectedSkills: result.selectedSkills,
        };
      } finally {
        this.#activeRuns.delete(request.id);
      }
    }
    if (request.type === "log.list") {
      return {
        id: request.id,
        type: "log.list.result",
        logs: await listConversationLogs(),
        storagePath: getLogStoragePath(),
      };
    }
    if (request.type === "log.get") {
      return {
        id: request.id,
        type: "log.detail",
        log: await getConversationLog(request.conversationId),
      };
    }
    if (request.type === "log.save") {
      return {
        id: request.id,
        type: "log.saved",
        summary: await saveConversationLog(request.log),
      };
    }
    if (request.type === "log.delete") {
      return {
        id: request.id,
        type: "log.deleted",
        conversationId: await deleteConversationLog(request.conversationId),
      };
    }
    if (request.type === "repository.analyze") {
      return { id: request.id, type: "repository.result", analysis: await this.repositoryProvider.analyze(request.element, request.apiRequests) };
    }
    if (request.type === "skill.list") {
      return { id: request.id, type: "skill.list.result", pageUrl: request.pageUrl, skills: listSkillsForPage(request.pageUrl, await loadSkills()) };
    }
    if (request.type === "skill.catalog") {
      return { id: request.id, type: "skill.catalog.result", ...await listSkillCatalog() };
    }
    if (request.type === "skill.get") {
      return { id: request.id, type: "skill.detail", skill: await getEditableSkill(request.slug) };
    }
    if (request.type === "skill.install") {
      return { id: request.id, type: "skill.installed", skill: await installMarketplaceSkill(request.slug) };
    }
    if (request.type === "skill.configure") {
      return {
        id: request.id,
        type: "skill.configured",
        skill: await configureAutomationSkill(request.slug, { enabled: request.enabled, pagePatterns: request.pagePatterns }),
      };
    }
    if (request.type === "skill.save") {
      return {
        id: request.id,
        type: "skill.saved",
        skill: await saveAutomationSkill(request.draft, undefined, request.existingSlug),
      };
    }
    if (request.type === "skill.delete") {
      return { id: request.id, type: "skill.deleted", slug: await deleteAutomationSkill(request.slug) };
    }
    if (request.type === "skill.export") {
      return { id: request.id, type: "skill.exported", ...await exportAutomationSkill(request.slug) };
    }
    if (request.type === "skill.import") {
      return { id: request.id, type: "skill.saved", skill: await importAutomationSkill(request.bundle) };
    }
    if (request.type === "skill.summarize") {
      return { id: request.id, type: "skill.summary.result", draft: summarizeSkill(request.input) };
    }
    return assertNever(request);
  }
}

function validateClientMessage(raw: unknown): ClientMessage {
  if (!raw || typeof raw !== "object") throw new Error("Invalid native bridge request.");
  const request = raw as { id?: unknown; type?: unknown };
  if (typeof request.id !== "string" || typeof request.type !== "string") throw new Error("Invalid native bridge request.");
  return raw as ClientMessage;
}

function readRequestId(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "unknown";
  const id = (raw as { id?: unknown }).id;
  return typeof id === "string" ? id : "unknown";
}

function assertNever(value: never): never {
  const type = (value as { type?: unknown }).type;
  throw new Error(`Unknown bridge request${typeof type === "string" ? `: ${type}` : ""}.`);
}
