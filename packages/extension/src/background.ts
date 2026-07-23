import type { ActionExecutionResult, AgentEvent, AgentLoopContext, AutomationSkillDraft, BrowserActionPlan, BrowserTabTarget, ChatMessage, ClientMessage, ElementSelectionGeometry, InspectedElement, PageSnapshot, RecordedBrowserAction, ServerMessage } from "@auto-page-agent/shared";
import { PendingAgentRunStore } from "./pending-agent-run.js";
import { calculateScreenshotCrop } from "./screenshot-crop.js";

const BRIDGE_URL = "ws://127.0.0.1:3210";
let socket: WebSocket | null = null;
let connecting: Promise<WebSocket> | null = null;
const RECORDING_KEY = "automationRecording";
const SELECTION_STORAGE_KEYS = [
  "selectedElement",
  "selectedElementPageUrl",
  "selectedElementTabId",
  "selectedElementScreenshot",
] as const;
const MAX_SCREENSHOT_DATA_URL_LENGTH = 2_000_000;
const MAX_SCREENSHOT_BYTES = 1_400_000;
const MAX_SCREENSHOT_DIMENSION = 1_600;
const pendingAgentRuns = new PendingAgentRunStore(chrome.storage.session);
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
  void chrome.runtime.sendMessage({ type: "ui.tabs.changed", reason: "activated" }).catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) void clearSelectionForTab(tabId);
  if (changeInfo.url || changeInfo.title || changeInfo.status === "complete") {
    void chrome.runtime.sendMessage({
      type: "ui.tabs.changed",
      reason: changeInfo.url ? "navigated" : "updated",
      tabId,
    }).catch(() => undefined);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearSelectionForTab(tabId);
  void chrome.runtime.sendMessage({ type: "ui.tabs.changed", reason: "removed", tabId }).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "page.element.selected") {
    void handleElementSelected(message, _sender);
    return false;
  }
  if (message?.type === "page.selection.cancelled") {
    void chrome.runtime.sendMessage({ type: "ui.selection.cancelled", reason: message.reason }).catch(() => undefined);
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
    void Promise.all([
      chrome.storage.session.remove([...SELECTION_STORAGE_KEYS]),
      conversationId ? pendingAgentRuns.clearForConversation(conversationId) : Promise.resolve(),
      conversationId ? requestBridge({ id: crypto.randomUUID(), type: "agent.reset", conversationId }) : Promise.resolve(undefined),
    ]).then(() => sendResponse({ ok: true })).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.selection.current") {
    void currentSelection(Number(message.targetTabId)).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.selection.clear") {
    void chrome.storage.session.remove([...SELECTION_STORAGE_KEYS]).then(() => sendResponse({ ok: true })).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.run") {
    void runTask(
      String(message.task ?? ""),
      String(message.conversationId ?? ""),
      Array.isArray(message.history) ? message.history as ChatMessage[] : [],
      Number(message.targetTabId),
      message.screenshot && typeof message.screenshot === "object" ? message.screenshot as { dataUrl?: string; title?: string; url?: string } : undefined,
    ).then(sendResponse).catch(toErrorResponse(sendResponse));
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
    void startSelection(message.mode === "image" ? "image" : "element", Number(message.targetTabId)).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.screenshot.capture") {
    void captureScreenshot(Number(message.targetTabId)).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.recording.start") {
    void startRecording(Number(message.targetTabId)).then(sendResponse).catch(toErrorResponse(sendResponse));
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
    void replayRecording(message.actions as RecordedBrowserAction[], Number(message.targetTabId)).then(sendResponse).catch(toErrorResponse(sendResponse));
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
    void listPageSkills(Number(message.targetTabId)).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.repository.analyze") {
    void analyzeRepository(message.element as InspectedElement, String(message.pageUrl ?? ""), Number(message.targetTabId)).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.tabs.list") {
    void listTargetTabs().then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.tab.activate") {
    void activateTargetTab(Number(message.targetTabId)).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  return false;
});

async function handleElementSelected(message: {
  mode?: string;
  element?: InspectedElement;
  geometry?: ElementSelectionGeometry;
  pageUrl?: string;
}, sender: chrome.runtime.MessageSender) {
  const tab = sender.tab;
  if (typeof tab?.id !== "number" || typeof tab.windowId !== "number" || !message.element || typeof message.pageUrl !== "string") {
    await chrome.runtime.sendMessage({ type: "ui.selection.cancelled", reason: "The selected page is no longer available." }).catch(() => undefined);
    return;
  }
  try {
    const screenshot = message.mode === "image"
      ? await captureSelectedElement(tab, message.geometry, message.element.tagName)
      : undefined;
    const currentTab = await chrome.tabs.get(tab.id);
    if (currentTab.url !== message.pageUrl) throw new Error("The page navigated before the selection could be captured.");
    await chrome.storage.session.set({
      selectedElement: message.element,
      selectedElementPageUrl: message.pageUrl,
      selectedElementTabId: tab.id,
    });
    if (screenshot) await chrome.storage.session.set({ selectedElementScreenshot: screenshot });
    else await chrome.storage.session.remove(["selectedElementScreenshot"]);
    await chrome.runtime.sendMessage({
      type: "ui.element.selected",
      element: message.element,
      pageUrl: message.pageUrl,
      tabId: tab.id,
      screenshot,
    }).catch(() => undefined);
  } catch (error) {
    await chrome.runtime.sendMessage({
      type: "ui.selection.cancelled",
      reason: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
  }
}

async function currentSelection(targetTabId: number) {
  const tab = await getTargetTab(targetTabId);
  const stored = await chrome.storage.session.get([...SELECTION_STORAGE_KEYS]);
  if (stored.selectedElementPageUrl !== tab.url || stored.selectedElementTabId !== tab.id) {
    await chrome.storage.session.remove([...SELECTION_STORAGE_KEYS]);
    return {};
  }
  return stored;
}

async function clearSelectionForTab(tabId: number) {
  const stored = await chrome.storage.session.get(["selectedElementTabId"]);
  if (stored.selectedElementTabId !== tabId) return;
  await chrome.storage.session.remove([...SELECTION_STORAGE_KEYS]);
  await chrome.runtime.sendMessage({ type: "ui.selection.cleared", tabId }).catch(() => undefined);
}

function normalizeScreenshot(
  screenshot: { dataUrl?: string; title?: string; url?: string } | undefined,
  tab: chrome.tabs.Tab,
): { dataUrl: string; title: string; url: string } | undefined {
  if (!screenshot?.dataUrl?.startsWith("data:image/")) return undefined;
  if (screenshot.dataUrl.length > MAX_SCREENSHOT_DATA_URL_LENGTH) {
    throw new Error("The screenshot is too large. Select a smaller visible element or capture it at a lower display scale.");
  }
  return {
    dataUrl: screenshot.dataUrl,
    title: String(screenshot.title ?? "Current viewport").slice(0, 300),
    url: String(screenshot.url ?? tab.url ?? "").slice(0, 2_000),
  };
}

async function runTask(task: string, conversationId: string, history: ChatMessage[], targetTabId: number, screenshot?: { dataUrl?: string; title?: string; url?: string }): Promise<ServerMessage> {
  if (!task.trim()) throw new Error("Enter a task first.");
  const tab = await getTargetTab(targetTabId);
  const snapshot = await sendPageMessage<PageSnapshot>(tab.id, { type: "page.snapshot" });
  const stored = await chrome.storage.session.get([...SELECTION_STORAGE_KEYS]);
  const selectionIsCurrent = stored.selectedElementPageUrl === tab.url && stored.selectedElementTabId === tab.id;
  const selectedElement = selectionIsCurrent && stored.selectedElement ? stored.selectedElement as InspectedElement : undefined;
  const selectedScreenshot = normalizeScreenshot(
    screenshot?.dataUrl?.startsWith("data:image/") ? screenshot : selectionIsCurrent ? stored.selectedElementScreenshot as { dataUrl?: string; title?: string; url?: string } | undefined : undefined,
    tab,
  );
  if (selectedElement || selectedScreenshot) snapshot.context = { ...(selectedElement ? { selectedElement } : {}), ...(selectedScreenshot ? { screenshot: selectedScreenshot } : {}) };
  const pendingRun = {
    task,
    conversationId: conversationId || crypto.randomUUID(),
    history: history.slice(-20),
    snapshotId: snapshot.snapshotId,
    tabId: tab.id,
    pageUrl: snapshot.url,
  };
  await pendingAgentRuns.save(pendingRun);
  try {
    const response = await requestBridge({
      id: crypto.randomUUID(),
      type: "agent.run",
      task,
      snapshot,
      conversationId: pendingRun.conversationId,
      history: pendingRun.history,
    }, emitUiEvent);
    if (response.type === "agent.result" && response.decision.kind === "action_plan") {
      if (response.decision.snapshotId !== pendingRun.snapshotId) {
        await pendingAgentRuns.clearForSnapshot(pendingRun.snapshotId);
        throw new Error("The agent returned a plan for an expired page snapshot.");
      }
      return response;
    }
    await pendingAgentRuns.clearForSnapshot(pendingRun.snapshotId);
    return response;
  } catch (error) {
    await pendingAgentRuns.clearForSnapshot(pendingRun.snapshotId);
    throw error;
  }
}

async function startSelection(mode: "element" | "image", targetTabId: number) {
  const tab = await getTargetTab(targetTabId);
  await chrome.tabs.update(tab.id, { active: true });
  if (typeof tab.windowId === "number") await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
  return sendPageMessage(tab.id, { type: "page.selection.start", mode });
}

async function analyzeRepository(element: InspectedElement, pageUrl: string, targetTabId: number): Promise<ServerMessage> {
  const tab = await getTargetTab(targetTabId);
  if (tab.url !== pageUrl) throw new Error("The selected element belongs to an earlier page. Select it again.");
  const performance = await sendPageMessage<PageSnapshot["performance"]>(tab.id, { type: "page.performance" });
  return requestBridge({ id: crypto.randomUUID(), type: "repository.analyze", pageUrl, element, apiRequests: performance.apiRequests });
}

async function executePlan(plan: BrowserActionPlan, tabId: number) {
  return sendPageMessage(tabId, { type: "page.actions.execute", plan });
}

async function runAgentLoop(initialPlan: BrowserActionPlan) {
  const pendingRun = await pendingAgentRuns.loadForPlan(initialPlan.snapshotId);
  try {
    const initialTab = await getTargetTab(pendingRun.tabId);
    if (initialTab.url !== pendingRun.pageUrl) {
      throw new Error("The target page navigated after this plan was created. Run the task again.");
    }
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
      let execution = await executePlanResilient({ ...plan, steps: [step] }, pendingRun.tabId);
      if (!execution.snapshot) execution = { ...execution, snapshot: await readSnapshot(pendingRun.tabId) };
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
        id: crypto.randomUUID(), type: "agent.run", task: pendingRun.task, snapshot: observedSnapshot,
        conversationId: pendingRun.conversationId, history: pendingRun.history, loop,
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
    throw new Error("The agent stopped at its time budget.");
  } finally {
    await pendingAgentRuns.clearForSnapshot(initialPlan.snapshotId);
  }
}

async function executePlanResilient(plan: BrowserActionPlan, tabId: number): Promise<ActionExecutionResult> {
  try { return await executePlan(plan, tabId) as ActionExecutionResult; }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/message port closed|receiving end does not exist|context invalidated|frame was removed/iu.test(message)) throw error;
    await waitForTabReady(tabId);
    const snapshot = await readSnapshot(tabId);
    const diff = { urlChanged: true, titleChanged: false, addedFingerprints: [], removedFingerprints: [], changedFingerprints: [], summary: ["The page navigated and a new document was observed."] };
    return { ok: true, results: [{ action: plan.steps[0]?.action ?? "click", ok: true }], snapshot, verification: { success: true, summary: diff.summary[0]!, changes: diff.summary, diff } };
  }
}

async function waitForTabReady(tabId: number, timeoutMs = 8_000): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(done, timeoutMs);
    function done() { clearTimeout(timeout); chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); }
    function onUpdated(updatedTabId: number, info: chrome.tabs.TabChangeInfo) { if (updatedTabId === tabId && info.status === "complete") done(); }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function readSnapshot(tabId: number): Promise<PageSnapshot> {
  await getTargetTab(tabId);
  return sendPageMessage<PageSnapshot>(tabId, { type: "page.snapshot" });
}

function emitUiEvent(event: AgentEvent) {
  void chrome.runtime.sendMessage({ type: "ui.agent.event", event }).catch(() => undefined);
}

function createEvent(event: AgentEventInput): AgentEvent {
  return { ...event, id: crypto.randomUUID(), timestamp: new Date().toISOString() } as AgentEvent;
}

async function listPageSkills(targetTabId: number): Promise<ServerMessage> {
  const tab = await getTargetTab(targetTabId);
  return requestBridge({ id: crypto.randomUUID(), type: "skill.list", pageUrl: tab.url!, pageTitle: tab.title ?? "" });
}

async function captureScreenshot(targetTabId: number) {
  const tab = await getTargetTab(targetTabId);
  await activateTargetTab(tab.id);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 82 });
  if (dataUrl.length > MAX_SCREENSHOT_DATA_URL_LENGTH) {
    throw new Error("The viewport screenshot is too large. Reduce the window size or display scale and try again.");
  }
  return { ok: true, dataUrl, url: tab.url, title: tab.title, capturedAt: new Date().toISOString() };
}

async function captureSelectedElement(tab: chrome.tabs.Tab, geometry: ElementSelectionGeometry | undefined, tagName: string) {
  if (!geometry) throw new Error("The selected element did not provide capture coordinates.");
  const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (activeTab?.id !== tab.id) throw new Error("The selected tab must remain visible while it is captured.");

  const viewportDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 90 });
  const response = await fetch(viewportDataUrl);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const crop = calculateScreenshotCrop(geometry, bitmap.width, bitmap.height);
    const dataUrl = await encodeCroppedJpeg(bitmap, crop.source);
    return {
      dataUrl,
      url: tab.url ?? "",
      title: `Selected <${tagName}>`,
    };
  } finally {
    bitmap.close();
  }
}

async function encodeCroppedJpeg(bitmap: ImageBitmap, source: { x: number; y: number; width: number; height: number }) {
  let outputScale = Math.min(1, MAX_SCREENSHOT_DIMENSION / Math.max(source.width, source.height));
  let quality = 0.82;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const width = Math.max(1, Math.round(source.width * outputScale));
    const height = Math.max(1, Math.round(source.height * outputScale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable for the selected-element capture.");
    context.drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    if (blob.size <= MAX_SCREENSHOT_BYTES) return blobToDataUrl(blob);
    outputScale *= Math.min(0.82, Math.sqrt(MAX_SCREENSHOT_BYTES / blob.size) * 0.92);
    quality = Math.max(0.5, quality - 0.08);
  }
  throw new Error("The selected element screenshot is too large. Select a smaller visible area.");
}

async function blobToDataUrl(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

async function startRecording(targetTabId: number) {
  const tab = await getTargetTab(targetTabId);
  const state: RecordingState = { active: true, tabId: tab.id, startedAt: Date.now(), startUrl: tab.url!, actions: [] };
  await chrome.storage.session.set({ [RECORDING_KEY]: state });
  await sendPageMessage(tab.id, { type: "page.recording.start" });
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

async function replayRecording(actions: RecordedBrowserAction[], targetTabId: number) {
  if (!Array.isArray(actions) || !actions.length) throw new Error("There are no recorded actions to replay.");
  if (actions.length > 100) throw new Error("At most 100 actions can be replayed.");
  const tab = await getTargetTab(targetTabId);
  return sendPageMessage(tab.id, { type: "page.recording.replay", actions });
}

async function resumeRecordingForSender(tabId: number | undefined) {
  if (typeof tabId !== "number") return;
  const state = await getRecordingState();
  if (state?.active && state.tabId === tabId) await sendPageMessage(tabId, { type: "page.recording.start" }).catch(() => undefined);
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

async function getTargetTab(tabId: number): Promise<chrome.tabs.Tab & { id: number }> {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error("Choose a target page before running the agent.");
  let tab: chrome.tabs.Tab;
  try { tab = await chrome.tabs.get(tabId); }
  catch { throw new Error("The target page was closed. Choose another tab."); }
  if (typeof tab.id !== "number" || !/^https?:/u.test(tab.url ?? "")) {
    throw new Error("The target must be an open http(s) page.");
  }
  return tab as chrome.tabs.Tab & { id: number };
}

async function listTargetTabs(): Promise<{ tabs: BrowserTabTarget[]; activeTabId?: number }> {
  const [tabs, activeTab] = await Promise.all([
    chrome.tabs.query({}),
    getActiveTab().catch(() => undefined),
  ]);
  return {
    tabs: tabs
      .filter((tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === "number" && /^https?:/u.test(tab.url ?? ""))
      .map(toBrowserTabTarget),
    ...(activeTab ? { activeTabId: activeTab.id } : {}),
  };
}

function toBrowserTabTarget(tab: chrome.tabs.Tab & { id: number }): BrowserTabTarget {
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    title: tab.title || new URL(tab.url!).hostname,
    url: tab.url!,
    ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
    active: Boolean(tab.active),
  };
}

async function activateTargetTab(targetTabId: number): Promise<{ ok: true }> {
  const tab = await getTargetTab(targetTabId);
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
  return { ok: true };
}

async function sendPageMessage<T = unknown>(tabId: number, message: unknown): Promise<T> {
  try {
    return await chrome.tabs.sendMessage(tabId, message) as T;
  } catch (error) {
    if (!isMissingPageReceiver(error)) throw error;
  }

  await waitForTabReady(tabId);
  try {
    return await chrome.tabs.sendMessage(tabId, message) as T;
  } catch (error) {
    if (!isMissingPageReceiver(error)) throw error;
  }

  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  return chrome.tabs.sendMessage(tabId, message) as Promise<T>;
}

function isMissingPageReceiver(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /could not establish connection|receiving end does not exist/iu.test(message);
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
