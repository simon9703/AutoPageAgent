import type { ActionExecutionResult, AgentEvent, AgentLoopContext, AutomationSkillDraft, BrowserActionPlan, ChatMessage, ElementSelectionGeometry, InspectedElement, PageSnapshot, RecordedBrowserAction, ServerMessage } from "@auto-page-agent/shared";
import { requestBridge } from "./background/bridge-client.js";
import { PendingAgentRunStore } from "./background/pending-agent-run.js";
import {
  appendRecordedAction,
  getRecordingState,
  replayRecording,
  resumeRecordingForSender,
  startRecording,
  stopRecording,
} from "./background/recording.js";
import {
  captureScreenshot,
  captureSelectedElement,
  MAX_SCREENSHOT_DATA_URL_LENGTH,
} from "./background/screenshot.js";
import {
  activateTargetTab,
  getTargetTab,
  listTargetTabs,
  sendPageMessage,
  waitForTabReady,
} from "./background/tabs.js";

const SELECTION_STORAGE_KEYS = [
  "selectedElement",
  "selectedElementPageUrl",
  "selectedElementTabId",
  "selectedElementScreenshot",
] as const;
const pendingAgentRuns = new PendingAgentRunStore(chrome.storage.session);
type EventWithoutMeta<T> = T extends unknown ? Omit<T, "id" | "timestamp"> : never;
type AgentEventInput = EventWithoutMeta<AgentEvent>;

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
    void handleElementSelected(message, _sender).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
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
      clearStoredSelection(),
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
    void clearStoredSelection().then(() => sendResponse({ ok: true })).catch(toErrorResponse(sendResponse));
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
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await chrome.runtime.sendMessage({
      type: "ui.selection.cancelled",
      reason,
    }).catch(() => undefined);
    return { ok: false, error: reason };
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

async function clearStoredSelection() {
  const stored = await chrome.storage.session.get(["selectedElementTabId"]);
  if (typeof stored.selectedElementTabId === "number") {
    await sendPageMessage(stored.selectedElementTabId, { type: "page.selection.clear" }).catch(() => undefined);
  }
  await chrome.storage.session.remove([...SELECTION_STORAGE_KEYS]);
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
    await sendPageMessage(pendingRun.tabId, { type: "page.agent.activity", active: true }).catch(() => undefined);
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
    await sendPageMessage(pendingRun.tabId, { type: "page.agent.activity", active: false }).catch(() => undefined);
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

function toErrorResponse(sendResponse: (response?: unknown) => void) {
  return (error: unknown) => sendResponse({ type: "agent.error", error: error instanceof Error ? error.message : String(error) });
}
