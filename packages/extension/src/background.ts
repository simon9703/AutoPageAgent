import type { ActionExecutionResult, AgentEvent, AgentLoopContext, AutomationSkillDraft, BrowserActionPlan, ChatMessage, ClientMessage, InspectedElement, PageSnapshot, RecordedBrowserAction, ServerMessage } from "@auto-page-agent/shared";

const BRIDGE_URL = "ws://127.0.0.1:3210";
let socket: WebSocket | null = null;
let connecting: Promise<WebSocket> | null = null;
const RECORDING_KEY = "automationRecording";
let pendingAgentRun: { task: string; conversationId: string; history: ChatMessage[] } | null = null;
type EventWithoutMeta<T> = T extends unknown ? Omit<T, "id" | "timestamp"> : never;
type AgentEventInput = EventWithoutMeta<AgentEvent>;

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
  if (message?.type === "page.selection.cancelled") {
    void chrome.runtime.sendMessage({ type: "ui.selection.cancelled" }).catch(() => undefined);
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
  if (message?.type === "ui.conversation.reset") {
    const conversationId = String(message.conversationId ?? "");
    pendingAgentRun = pendingAgentRun?.conversationId === conversationId ? null : pendingAgentRun;
    void Promise.all([
      chrome.storage.session.remove(["selectedElement", "selectedElementPageUrl"]),
      conversationId ? requestBridge({ id: crypto.randomUUID(), type: "agent.reset", conversationId }) : Promise.resolve(undefined),
    ]).then(() => sendResponse({ ok: true })).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.selection.current") {
    void chrome.storage.session.get(["selectedElement", "selectedElementPageUrl"]).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.selection.clear") {
    void chrome.storage.session.remove(["selectedElement", "selectedElementPageUrl"]).then(() => sendResponse({ ok: true })).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.run") {
    void runTask(String(message.task ?? ""), String(message.conversationId ?? ""), Array.isArray(message.history) ? message.history as ChatMessage[] : []).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.execute") {
    void runAgentLoop(message.plan as BrowserActionPlan).then(sendResponse).catch((error) => {
      emitUiEvent(createEvent({ type: "error", error: error instanceof Error ? error.message : String(error), recoverable: false }));
      toErrorResponse(sendResponse)(error);
    });
    return true;
  }
  if (message?.type === "ui.selection.start") {
    void startSelection(message.mode === "image" ? "image" : "element").then(sendResponse).catch(toErrorResponse(sendResponse));
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
    void requestBridge({ id: crypto.randomUUID(), type: "skill.save", draft: message.draft as AutomationSkillDraft, ...(typeof message.existingSlug === "string" ? { existingSlug: message.existingSlug } : {}) }).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.skills.catalog") {
    void requestBridge({ id: crypto.randomUUID(), type: "skill.catalog" }).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.skill.get") {
    void requestBridge({ id: crypto.randomUUID(), type: "skill.get", slug: String(message.slug ?? "") }).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.skill.install") {
    void requestBridge({ id: crypto.randomUUID(), type: "skill.install", slug: String(message.slug ?? "") }).then(sendResponse).catch(toErrorResponse(sendResponse));
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

async function runTask(task: string, conversationId: string, history: ChatMessage[]): Promise<ServerMessage> {
  if (!task.trim()) throw new Error("Enter a task first.");
  const tab = await getActiveTab();
  const snapshot = await chrome.tabs.sendMessage(tab.id, { type: "page.snapshot" }) as PageSnapshot;
  const stored = await chrome.storage.session.get(["selectedElement", "selectedElementPageUrl"]);
  if (stored.selectedElement && stored.selectedElementPageUrl === tab.url) snapshot.context = { selectedElement: stored.selectedElement as InspectedElement };
  pendingAgentRun = { task, conversationId: conversationId || crypto.randomUUID(), history: history.slice(-20) };
  return requestBridge({ id: crypto.randomUUID(), type: "agent.run", task, snapshot, conversationId: pendingAgentRun.conversationId, history: pendingAgentRun.history }, emitUiEvent);
}

async function startSelection(mode: "element" | "image") {
  const tab = await getActiveTab();
  const response = await chrome.tabs.sendMessage(tab.id, { type: "page.selection.start", mode });
  await chrome.tabs.update(tab.id, { active: true });
  if (typeof tab.windowId === "number") await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
  return response;
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

async function runAgentLoop(initialPlan: BrowserActionPlan) {
  if (!pendingAgentRun) throw new Error("The original agent task expired. Run the task again.");
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  const maxSteps = 8;
  const timeoutMs = 90_000;
  let iteration = 0;
  let failures = 0;
  let plan = initialPlan;
  let latestAnswer = "Task completed.";
  while (iteration < maxSteps && Date.now() - startedAt < timeoutMs) {
    const step = plan.steps[0];
    if (!step) throw new Error("The agent returned an empty action plan.");
    emitUiEvent(createEvent({ type: "action", action: step.action, targetRef: step.targetRef, status: "running", step: iteration + 1, detail: step.reason }));
    let execution = await executePlanResilient({ ...plan, steps: [step] });
    if (!execution.snapshot) execution = { ...execution, snapshot: await readCurrentSnapshot() };
    const observedSnapshot = execution.snapshot!;
    emitUiEvent(createEvent({ type: "action", action: step.action, targetRef: step.targetRef, status: execution.ok ? "success" : "failed", step: iteration + 1, detail: execution.error }));
    const verification = execution.verification;
    emitUiEvent(createEvent({ type: "verify", success: Boolean(verification?.success ?? execution.ok), summary: verification?.summary ?? execution.error ?? "Action observation completed.", changes: verification?.changes, changedRefs: verification?.diff.changedFingerprints, step: iteration + 1 }));
    if (!execution.ok) failures += 1;
    else failures = 0;
    iteration += 1;
    if (failures >= 2) throw new Error("The agent stopped after two consecutive verification failures.");
    const loop: AgentLoopContext = {
      runId, iteration, maxSteps, timeoutMs, startedAt,
      previousSnapshot: observedSnapshot,
      lastAction: step,
      ...(verification ? { lastVerification: verification } : {}),
    };
    const response = await requestBridge({
      id: crypto.randomUUID(), type: "agent.run", task: pendingAgentRun.task, snapshot: observedSnapshot,
      conversationId: pendingAgentRun.conversationId, history: pendingAgentRun.history, loop,
    }, emitUiEvent);
    if (response.type === "agent.error") throw new Error(response.error);
    if (response.type !== "agent.result") throw new Error("Unexpected agent loop response.");
    if (response.decision.kind === "answer") {
      latestAnswer = response.decision.content;
      return { ok: true, answer: latestAnswer, steps: iteration };
    }
    if (iteration >= maxSteps || Date.now() - startedAt >= timeoutMs) throw new Error(`The agent stopped at its ${iteration >= maxSteps ? "step" : "time"} budget.`);
    plan = response.decision;
  }
  return { ok: true, answer: latestAnswer, steps: iteration };
}

async function executePlanResilient(plan: BrowserActionPlan): Promise<ActionExecutionResult> {
  try { return await executePlan(plan) as ActionExecutionResult; }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/message port closed|receiving end does not exist|context invalidated|frame was removed/iu.test(message)) throw error;
    await waitForActiveTabReady();
    const snapshot = await readCurrentSnapshot();
    const diff = { urlChanged: true, titleChanged: false, addedFingerprints: [], removedFingerprints: [], changedFingerprints: [], summary: ["The page navigated and a new document was observed."] };
    return { ok: true, results: [{ action: plan.steps[0]?.action ?? "click", ok: true }], snapshot, verification: { success: true, summary: diff.summary[0]!, changes: diff.summary, diff } };
  }
}

async function waitForActiveTabReady(timeoutMs = 8_000): Promise<void> {
  const tab = await getActiveTab();
  if (tab.status === "complete") return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(done, timeoutMs);
    function done() { clearTimeout(timeout); chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); }
    function onUpdated(tabId: number, info: chrome.tabs.TabChangeInfo) { if (tabId === tab.id && info.status === "complete") done(); }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function readCurrentSnapshot(): Promise<PageSnapshot> {
  const tab = await getActiveTab();
  return chrome.tabs.sendMessage(tab.id, { type: "page.snapshot" }) as Promise<PageSnapshot>;
}

function emitUiEvent(event: AgentEvent) {
  void chrome.runtime.sendMessage({ type: "ui.agent.event", event }).catch(() => undefined);
}

function createEvent(event: AgentEventInput): AgentEvent {
  return { ...event, id: crypto.randomUUID(), timestamp: new Date().toISOString() } as AgentEvent;
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

async function requestBridge(message: ClientMessage, onEvent?: (event: AgentEvent) => void): Promise<ServerMessage> {
  const ws = await connect();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      reject(new Error("Local bridge timed out."));
    }, 75_000);
    const onMessage = (event: MessageEvent<string>) => {
      let response: ServerMessage;
      try { response = JSON.parse(event.data) as ServerMessage; }
      catch { clearTimeout(timeout); ws.removeEventListener("message", onMessage); reject(new Error("Local bridge returned malformed JSON.")); return; }
      if (response.id !== message.id) return;
      if (response.type === "agent.event") { onEvent?.(response.event); return; }
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
