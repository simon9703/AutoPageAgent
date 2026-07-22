import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "@auto-page-agent/shared";
import { CodexProvider } from "./agent.js";
import { loadRepositoryRoots, LocalRepositoryProvider } from "./repositories.js";

const host = "127.0.0.1";
const port = Number(process.env.AUTO_PAGE_AGENT_PORT || 3210);
const provider = new CodexProvider();
const repositoryProvider = new LocalRepositoryProvider(await loadRepositoryRoots());
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "chrome-extension://*" });
  response.end(JSON.stringify({ ok: true, provider: provider.name }));
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
        const codex = await provider.status();
        response = { id: requestMessage.id, type: "health.result", ok: codex.available && codex.authenticated, provider: provider.name, repositories: repositoryProvider.roots.map((root) => root.name), codex };
      }
      else if (requestMessage.type === "agent.run") response = { id: requestMessage.id, type: "agent.result", decision: await provider.run(requestMessage.task, requestMessage.snapshot) };
      else if (requestMessage.type === "repository.analyze") response = { id: requestMessage.id, type: "repository.result", analysis: await repositoryProvider.analyze(requestMessage.element, requestMessage.apiRequests) };
      else throw new Error("Unknown bridge request.");
      socket.send(JSON.stringify(response));
    } catch (error) {
      socket.send(JSON.stringify({ id: requestMessage?.id ?? "unknown", type: "agent.error", error: error instanceof Error ? error.message : String(error) } satisfies ServerMessage));
    }
  });
});

server.listen(port, host, () => {
  console.log(`Auto Page Agent bridge listening on ws://${host}:${port} (${provider.name})`);
});
