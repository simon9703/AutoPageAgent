import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "@auto-page-agent/shared";
import { AgentRouter } from "./agent.js";
import { loadRepositoryRoots, LocalRepositoryProvider } from "./repositories.js";
import { configureAutomationSkill, getEditableSkill, installMarketplaceSkill, listSkillCatalog, listSkillsForPage, loadSkills, saveAutomationSkill } from "./skills.js";

const host = "127.0.0.1";
const port = Number(process.env.AUTO_PAGE_AGENT_PORT || 3210);
const provider = new AgentRouter();
const repositoryProvider = new LocalRepositoryProvider(await loadRepositoryRoots());
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "chrome-extension://*" });
  response.end(JSON.stringify({ ok: true, provider: "Auto" }));
});
const wss = new WebSocketServer({ server, maxPayload: 2 * 1024 * 1024 });

wss.on("connection", (socket, request) => {
  const origin = request.headers.origin ?? "";
  if (!origin.startsWith("chrome-extension://")) {
    socket.close(1008, "Chrome extension origin required");
    return;
  }
  socket.on("message", async (raw) => {
    let requestMessage: ClientMessage | undefined;
    try {
      requestMessage = JSON.parse(String(raw)) as ClientMessage;
      let response: ServerMessage;
      if (requestMessage.type === "health.check") {
        const codex = await provider.codex.status();
        const agent = await provider.status(codex);
        response = { id: requestMessage.id, type: "health.result", ok: agent.available && agent.authenticated, provider: agent.name, repositories: repositoryProvider.roots.map((root) => root.name), codex, agent };
      }
      else if (requestMessage.type === "agent.run") {
        const result = await provider.run(
          requestMessage.task,
          requestMessage.snapshot,
          { conversationId: requestMessage.conversationId, history: requestMessage.history, loop: requestMessage.loop },
          (event) => socket.send(JSON.stringify({ id: requestMessage!.id, type: "agent.event", event } satisfies ServerMessage)),
        );
        response = { id: requestMessage.id, type: "agent.result", decision: result.decision, provider: result.provider, conversationId: requestMessage.conversationId, selectedSkills: result.selectedSkills };
      }
      else if (requestMessage.type === "repository.analyze") response = { id: requestMessage.id, type: "repository.result", analysis: await repositoryProvider.analyze(requestMessage.element, requestMessage.apiRequests) };
      else if (requestMessage.type === "skill.list") response = { id: requestMessage.id, type: "skill.list.result", pageUrl: requestMessage.pageUrl, skills: listSkillsForPage(requestMessage.pageUrl, await loadSkills()) };
      else if (requestMessage.type === "skill.catalog") response = { id: requestMessage.id, type: "skill.catalog.result", ...await listSkillCatalog() };
      else if (requestMessage.type === "skill.get") response = { id: requestMessage.id, type: "skill.detail", skill: await getEditableSkill(requestMessage.slug) };
      else if (requestMessage.type === "skill.install") response = { id: requestMessage.id, type: "skill.installed", skill: await installMarketplaceSkill(requestMessage.slug) };
      else if (requestMessage.type === "skill.configure") response = { id: requestMessage.id, type: "skill.configured", skill: await configureAutomationSkill(requestMessage.slug, { enabled: requestMessage.enabled, pagePatterns: requestMessage.pagePatterns }) };
      else if (requestMessage.type === "skill.save") response = { id: requestMessage.id, type: "skill.saved", skill: await saveAutomationSkill(requestMessage.draft, undefined, requestMessage.existingSlug) };
      else throw new Error("Unknown bridge request.");
      socket.send(JSON.stringify(response));
    } catch (error) {
      socket.send(JSON.stringify({ id: requestMessage?.id ?? "unknown", type: "agent.error", error: error instanceof Error ? error.message : String(error) } satisfies ServerMessage));
    }
  });
});

server.listen(port, host, () => {
  console.log(`Auto Page Agent bridge listening on ws://${host}:${port} (auto provider)`);
});
