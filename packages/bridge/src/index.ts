import type { ClientMessage, ServerMessage } from "@auto-page-agent/shared";
import { AgentRouter } from "./agent.js";
import { NativeMessageDecoder, writeNativeMessage } from "./native-messaging.js";
import { loadRepositoryRoots, LocalRepositoryProvider } from "./repositories.js";
import { configureAutomationSkill, getEditableSkill, installMarketplaceSkill, listSkillCatalog, listSkillsForPage, loadSkills, saveAutomationSkill } from "./skills.js";

const provider = new AgentRouter();
const repositoryProvider = new LocalRepositoryProvider(await loadRepositoryRoots());
const activeRuns = new Map<string, AbortController>();
const decoder = new NativeMessageDecoder();

process.stdin.on("data", (chunk: Buffer) => {
  let messages: unknown[];
  try {
    messages = decoder.push(chunk);
  } catch (error) {
    process.stderr.write(`[auto-page-agent] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }
  for (const message of messages) void handleMessage(message);
});

process.stdin.on("end", () => {
  for (const controller of activeRuns.values()) controller.abort();
  activeRuns.clear();
});

async function handleMessage(raw: unknown): Promise<void> {
  let requestMessage: ClientMessage | undefined;
  try {
    requestMessage = raw as ClientMessage;
    if (!requestMessage || typeof requestMessage.id !== "string" || typeof requestMessage.type !== "string") {
      throw new Error("Invalid native bridge request.");
    }
    let response: ServerMessage;
    if (requestMessage.type === "health.check") {
      const codex = await provider.codex.status();
      const agent = await provider.status(codex);
      response = { id: requestMessage.id, type: "health.result", ok: agent.available && agent.authenticated, provider: agent.name, repositories: repositoryProvider.roots.map((root) => root.name), codex, agent };
    }
    else if (requestMessage.type === "agent.reset") {
      provider.reset(requestMessage.conversationId);
      response = { id: requestMessage.id, type: "agent.reset.result", conversationId: requestMessage.conversationId };
    }
    else if (requestMessage.type === "agent.cancel") {
      const controller = activeRuns.get(requestMessage.requestId);
      controller?.abort();
      response = { id: requestMessage.id, type: "agent.cancel.result", requestId: requestMessage.requestId, cancelled: Boolean(controller) };
    }
    else if (requestMessage.type === "agent.run") {
      const controller = new AbortController();
      activeRuns.set(requestMessage.id, controller);
      try {
        const result = await provider.run(
          requestMessage.task,
          requestMessage.snapshot,
          { conversationId: requestMessage.conversationId, history: requestMessage.history, loop: requestMessage.loop, signal: controller.signal },
          (event) => writeNativeMessage({ id: requestMessage!.id, type: "agent.event", event } satisfies ServerMessage),
        );
        response = { id: requestMessage.id, type: "agent.result", decision: result.decision, provider: result.provider, conversationId: requestMessage.conversationId, selectedSkills: result.selectedSkills };
      } finally {
        activeRuns.delete(requestMessage.id);
      }
    }
    else if (requestMessage.type === "repository.analyze") response = { id: requestMessage.id, type: "repository.result", analysis: await repositoryProvider.analyze(requestMessage.element, requestMessage.apiRequests) };
    else if (requestMessage.type === "skill.list") response = { id: requestMessage.id, type: "skill.list.result", pageUrl: requestMessage.pageUrl, skills: listSkillsForPage(requestMessage.pageUrl, await loadSkills()) };
    else if (requestMessage.type === "skill.catalog") response = { id: requestMessage.id, type: "skill.catalog.result", ...await listSkillCatalog() };
    else if (requestMessage.type === "skill.get") response = { id: requestMessage.id, type: "skill.detail", skill: await getEditableSkill(requestMessage.slug) };
    else if (requestMessage.type === "skill.install") response = { id: requestMessage.id, type: "skill.installed", skill: await installMarketplaceSkill(requestMessage.slug) };
    else if (requestMessage.type === "skill.configure") response = { id: requestMessage.id, type: "skill.configured", skill: await configureAutomationSkill(requestMessage.slug, { enabled: requestMessage.enabled, pagePatterns: requestMessage.pagePatterns }) };
    else if (requestMessage.type === "skill.save") response = { id: requestMessage.id, type: "skill.saved", skill: await saveAutomationSkill(requestMessage.draft, undefined, requestMessage.existingSlug) };
    else throw new Error("Unknown bridge request.");
    writeNativeMessage(response);
  } catch (error) {
    writeNativeMessage({ id: requestMessage?.id ?? "unknown", type: "agent.error", error: error instanceof Error ? error.message : String(error) } satisfies ServerMessage);
  }
}
