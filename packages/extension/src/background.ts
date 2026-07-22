import type { BrowserActionPlan, ClientMessage, PageSnapshot, ServerMessage } from "@auto-page-agent/shared";

const BRIDGE_URL = "ws://127.0.0.1:3210";
let socket: WebSocket | null = null;
let connecting: Promise<WebSocket> | null = null;

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ui.health") {
    void requestBridge({ id: crypto.randomUUID(), type: "health.check" }).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.run") {
    void runTask(String(message.task ?? "")).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.execute") {
    void executePlan(message.plan as BrowserActionPlan).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  return false;
});

async function runTask(task: string): Promise<ServerMessage> {
  if (!task.trim()) throw new Error("Enter a task first.");
  const tab = await getActiveTab();
  const snapshot = await chrome.tabs.sendMessage(tab.id, { type: "page.snapshot" }) as PageSnapshot;
  return requestBridge({ id: crypto.randomUUID(), type: "agent.run", task, snapshot });
}

async function executePlan(plan: BrowserActionPlan) {
  const tab = await getActiveTab();
  return chrome.tabs.sendMessage(tab.id, { type: "page.actions.execute", plan });
}

async function getActiveTab(): Promise<chrome.tabs.Tab & { id: number }> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || typeof tab.id !== "number" || !/^https?:/u.test(tab.url ?? "")) {
    throw new Error("Open an http(s) page before running the agent.");
  }
  return tab as chrome.tabs.Tab & { id: number };
}

async function requestBridge(message: ClientMessage): Promise<ServerMessage> {
  const ws = await connect();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      reject(new Error("Local bridge timed out."));
    }, 45_000);
    const onMessage = (event: MessageEvent<string>) => {
      const response = JSON.parse(event.data) as ServerMessage;
      if (response.id !== message.id) return;
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
    const timeout = setTimeout(() => reject(new Error("Local bridge is not running. Start it with npm run dev:bridge.")), 3_000);
    ws.addEventListener("open", () => {
      clearTimeout(timeout);
      socket = ws;
      connecting = null;
      resolve(ws);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      connecting = null;
      reject(new Error("Cannot connect to the local bridge at 127.0.0.1:3210."));
    });
    ws.addEventListener("close", () => { if (socket === ws) socket = null; });
  });
  return connecting;
}

function toErrorResponse(sendResponse: (response?: unknown) => void) {
  return (error: unknown) => sendResponse({ type: "agent.error", error: error instanceof Error ? error.message : String(error) });
}
