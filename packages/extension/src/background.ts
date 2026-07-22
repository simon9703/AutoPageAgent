import type { BrowserActionPlan, ClientMessage, InspectedElement, PageSnapshot, ServerMessage } from "@auto-page-agent/shared";

const BRIDGE_URL = "ws://127.0.0.1:3210";
let socket: WebSocket | null = null;
let connecting: Promise<WebSocket> | null = null;

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "page.element.selected") {
    void chrome.storage.session.set({ selectedElement: message.element, selectedElementPageUrl: message.pageUrl });
    void chrome.runtime.sendMessage({ type: "ui.element.selected", element: message.element, pageUrl: message.pageUrl }).catch(() => undefined);
    return false;
  }
  if (message?.type === "ui.health") {
    void requestBridge({ id: crypto.randomUUID(), type: "health.check" }).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.selection.current") {
    void chrome.storage.session.get(["selectedElement", "selectedElementPageUrl"]).then(sendResponse).catch(toErrorResponse(sendResponse));
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
  if (message?.type === "ui.selection.start") {
    void startSelection().then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.repository.analyze") {
    void analyzeRepository(message.element as InspectedElement, String(message.pageUrl ?? "")).then(sendResponse).catch(toErrorResponse(sendResponse));
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

async function startSelection() {
  const tab = await getActiveTab();
  return chrome.tabs.sendMessage(tab.id, { type: "page.selection.start" });
}

async function analyzeRepository(element: InspectedElement, pageUrl: string): Promise<ServerMessage> {
  const tab = await getActiveTab();
  const performance = await chrome.tabs.sendMessage(tab.id, { type: "page.performance" }) as PageSnapshot["performance"];
  return requestBridge({ id: crypto.randomUUID(), type: "repository.analyze", pageUrl, element, apiRequests: performance.apiRequests });
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
      let response: ServerMessage;
      try { response = JSON.parse(event.data) as ServerMessage; }
      catch { clearTimeout(timeout); ws.removeEventListener("message", onMessage); reject(new Error("Local bridge returned malformed JSON.")); return; }
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
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      connecting = null;
      ws.close();
      reject(new Error("Local bridge is not running. Start it with npm run dev:bridge."));
    }, 3_000);
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
    ws.addEventListener("close", () => { if (socket === ws) socket = null; });
  });
  return connecting;
}

function toErrorResponse(sendResponse: (response?: unknown) => void) {
  return (error: unknown) => sendResponse({ type: "agent.error", error: error instanceof Error ? error.message : String(error) });
}
