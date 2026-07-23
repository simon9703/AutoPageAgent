import type { AgentEvent, ClientMessage, ServerMessage } from "@auto-page-agent/shared";

const BRIDGE_URL = "ws://127.0.0.1:3210";
const CONNECT_TIMEOUT_MS = 3_000;
const REQUEST_TIMEOUT_MS = 75_000;

let socket: WebSocket | null = null;
let connecting: Promise<WebSocket> | null = null;

export async function requestBridge(
  message: ClientMessage,
  onEvent?: (event: AgentEvent) => void,
): Promise<ServerMessage> {
  const ws = await connect();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      reject(new Error("Local bridge timed out."));
    }, REQUEST_TIMEOUT_MS);
    const onMessage = (event: MessageEvent<string>) => {
      let response: ServerMessage;
      try {
        response = JSON.parse(event.data) as ServerMessage;
      } catch {
        clearTimeout(timeout);
        ws.removeEventListener("message", onMessage);
        reject(new Error("Local bridge returned malformed JSON."));
        return;
      }
      if (response.id !== message.id) return;
      if (response.type === "agent.event") {
        onEvent?.(response.event);
        return;
      }
      clearTimeout(timeout);
      ws.removeEventListener("message", onMessage);
      resolve(response);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify(message));
  });
}

async function connect(): Promise<WebSocket> {
  if (socket?.readyState === WebSocket.OPEN) return socket;
  if (connecting) return connecting;
  connecting = new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE_URL);
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      connecting = null;
      ws.close();
      reject(new Error("Local bridge is not running. Start it with npm run dev:bridge."));
    }, CONNECT_TIMEOUT_MS);
    ws.addEventListener("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket = ws;
      connecting = null;
      resolve(ws);
    });
    ws.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      connecting = null;
      reject(new Error("Cannot connect to the local bridge at 127.0.0.1:3210."));
    });
    ws.addEventListener("close", () => {
      if (socket === ws) socket = null;
    });
  });
  return connecting;
}
