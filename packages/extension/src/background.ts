import type { AutomationSkillDraft, BrowserActionPlan, ClientMessage, InspectedElement, PageSnapshot, RecordedBrowserAction, ServerMessage } from "@auto-page-agent/shared";

const BRIDGE_URL = "ws://127.0.0.1:3210";
let socket: WebSocket | null = null;
let connecting: Promise<WebSocket> | null = null;
const RECORDING_KEY = "automationRecording";

interface RecordingState {
  active: boolean;
  tabId: number;
  startedAt: number;
  startUrl: string;
  actions: RecordedBrowserAction[];
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.tabs.onActivated.addListener(() => {
  void chrome.runtime.sendMessage({ type: "ui.page.changed" }).catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.status === "complete")) {
    void chrome.runtime.sendMessage({ type: "ui.page.changed" }).catch(() => undefined);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "page.element.selected") {
    void chrome.storage.session.set({ selectedElement: message.element, selectedElementPageUrl: message.pageUrl });
    void chrome.runtime.sendMessage({ type: "ui.element.selected", element: message.element, pageUrl: message.pageUrl }).catch(() => undefined);
    return false;
  }
  if (message?.type === "page.recording.ready") {
    void resumeRecordingForSender(_sender.tab?.id);
    return false;
  }
  if (message?.type === "page.recording.action") {
    void appendRecordedAction(message.action as RecordedBrowserAction, _sender.tab?.id);
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
  if (message?.type === "ui.screenshot.capture") {
    void captureScreenshot().then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.recording.start") {
    void startRecording().then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.recording.stop") {
    void stopRecording().then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.recording.status") {
    void getRecordingState().then((state) => sendResponse(state ?? { active: false, actions: [] })).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.recording.replay") {
    void replayRecording(message.actions as RecordedBrowserAction[]).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.skill.save") {
    void requestBridge({ id: crypto.randomUUID(), type: "skill.save", draft: message.draft as AutomationSkillDraft }).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.skill.configure") {
    void requestBridge({
      id: crypto.randomUUID(),
      type: "skill.configure",
      slug: String(message.slug ?? ""),
      ...(typeof message.enabled === "boolean" ? { enabled: message.enabled } : {}),
      ...(Array.isArray(message.pagePatterns) ? { pagePatterns: message.pagePatterns.map(String) } : {}),
    }).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.skills.list") {
    void listPageSkills().then(sendResponse).catch(toErrorResponse(sendResponse));
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

async function listPageSkills(): Promise<ServerMessage> {
  const tab = await getActiveTab();
  return requestBridge({ id: crypto.randomUUID(), type: "skill.list", pageUrl: tab.url!, pageTitle: tab.title ?? "" });
}

async function captureScreenshot() {
  const tab = await getActiveTab();
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 82 });
  return { ok: true, dataUrl, url: tab.url, title: tab.title, capturedAt: new Date().toISOString() };
}

async function startRecording() {
  const tab = await getActiveTab();
  const state: RecordingState = { active: true, tabId: tab.id, startedAt: Date.now(), startUrl: tab.url!, actions: [] };
  await chrome.storage.session.set({ [RECORDING_KEY]: state });
  await chrome.tabs.sendMessage(tab.id, { type: "page.recording.start" });
  return state;
}

async function stopRecording() {
  const state = await getRecordingState();
  if (!state) return { active: false, actions: [] };
  await chrome.tabs.sendMessage(state.tabId, { type: "page.recording.stop" }).catch(() => undefined);
  const stopped = { ...state, active: false };
  await chrome.storage.session.set({ [RECORDING_KEY]: stopped });
  return stopped;
}

async function replayRecording(actions: RecordedBrowserAction[]) {
  if (!Array.isArray(actions) || !actions.length) throw new Error("There are no recorded actions to replay.");
  if (actions.length > 100) throw new Error("At most 100 actions can be replayed.");
  const tab = await getActiveTab();
  return chrome.tabs.sendMessage(tab.id, { type: "page.recording.replay", actions });
}

async function resumeRecordingForSender(tabId: number | undefined) {
  if (typeof tabId !== "number") return;
  const state = await getRecordingState();
  if (state?.active && state.tabId === tabId) await chrome.tabs.sendMessage(tabId, { type: "page.recording.start" }).catch(() => undefined);
}

async function appendRecordedAction(action: RecordedBrowserAction, tabId: number | undefined) {
  if (typeof tabId !== "number") return;
  const state = await getRecordingState();
  if (!state?.active || state.tabId !== tabId || state.actions.length >= 100) return;
  const sanitized: RecordedBrowserAction = {
    ...action,
    id: crypto.randomUUID(),
    value: action.sensitive ? undefined : action.value?.slice(0, 4_000),
    timestamp: Date.now(),
  };
  const actions = [...state.actions];
  const last = actions.at(-1);
  const replaceLast = last && (
    ((sanitized.action === "fill" || sanitized.action === "select") && last.action === sanitized.action && last.selector === sanitized.selector)
    || (sanitized.action === "scroll" && last.action === "scroll" && sanitized.timestamp - last.timestamp < 2_000)
  );
  if (replaceLast) actions[actions.length - 1] = sanitized;
  else actions.push(sanitized);
  await chrome.storage.session.set({ [RECORDING_KEY]: { ...state, actions } });
  void chrome.runtime.sendMessage({ type: "ui.recording.updated", actions }).catch(() => undefined);
}

async function getRecordingState(): Promise<RecordingState | undefined> {
  const stored = await chrome.storage.session.get(RECORDING_KEY);
  return stored[RECORDING_KEY] as RecordingState | undefined;
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
