import type { ActionExecutionResult, AgentEvent, AgentLoopContext, AutomationSkillDraft, BrowserActionPlan, ChatMessage, ElementSelectionGeometry, InspectedElement, PageSnapshot, PerformanceSnapshot, RecordedBrowserAction, ServerMessage } from "@auto-page-agent/shared";
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
import { taskNeedsPerformance } from "./background/task-context.js";

interface StoredSelection {
  selectedElement: InspectedElement;
  selectedElementPageUrl: string;
  selectedElementTabId: number;
  selectedElementScreenshot?: { dataUrl: string; title: string; url: string };
}

function selectionStorageKey(tabId: number): string {
  return `selectedElement:${tabId}`;
}
const pendingAgentRuns = new PendingAgentRunStore(chrome.storage.session);
type ActiveAgentRun = { conversationId: string; tabId: number; windowId: number; bridgeRequestId?: string; cancelled: boolean };
let activeAgentRun: ActiveAgentRun | null = null;
type EventWithoutMeta<T> = T extends unknown ? Omit<T, "id" | "timestamp"> : never;
type AgentEventInput = EventWithoutMeta<AgentEvent>;

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  void chrome.runtime.sendMessage({ type: "ui.tabs.changed", reason: "activated", tabId, windowId }).catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) void clearSelectionForTab(tabId, tab.windowId);
  if (changeInfo.url || changeInfo.title || changeInfo.status === "complete") {
    void chrome.runtime.sendMessage({
      type: "ui.tabs.changed",
      reason: changeInfo.url ? "navigated" : "updated",
      tabId,
      windowId: tab.windowId,
    }).catch(() => undefined);
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  void clearSelectionForTab(tabId, removeInfo.windowId);
  if (activeAgentRun?.tabId === tabId) void stopActiveAgentRun(activeAgentRun.conversationId);
  void chrome.runtime.sendMessage({ type: "ui.tabs.changed", reason: "removed", tabId, windowId: removeInfo.windowId }).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "page.element.selected") {
    void handleElementSelected(message, _sender).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "page.selection.cancelled") {
    void chrome.runtime.sendMessage({
      type: "ui.selection.cancelled",
      reason: message.reason,
      tabId: _sender.tab?.id,
      windowId: _sender.tab?.windowId,
    }).catch(() => undefined);
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
      clearStoredSelection(Number(message.targetTabId)),
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
    void clearStoredSelection(Number(message.targetTabId)).then(() => sendResponse({ ok: true })).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.run") {
    void runTask(
      String(message.task ?? ""),
      String(message.conversationId ?? ""),
      Array.isArray(message.history) ? message.history as ChatMessage[] : [],
      Number(message.targetTabId),
      Number(message.windowId),
      message.screenshot && typeof message.screenshot === "object" ? message.screenshot as { dataUrl?: string; title?: string; url?: string } : undefined,
    ).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.execute") {
    void runAgentLoop(
      message.plan as BrowserActionPlan,
      String(message.conversationId ?? ""),
      Number(message.targetTabId),
      Number(message.windowId),
    ).then(sendResponse).catch((error) => {
      emitUiEvent(
        createEvent({ type: "error", error: error instanceof Error ? error.message : String(error), recoverable: false }),
        String(message.conversationId ?? ""),
        Number(message.targetTabId),
        Number(message.windowId),
      );
      toErrorResponse(sendResponse)(error);
    });
    return true;
  }
  if (message?.type === "ui.agent.stop") {
    void stopActiveAgentRun(
      String(message.conversationId ?? ""),
      Number(message.targetTabId),
      Number(message.windowId),
    ).then(sendResponse).catch(toErrorResponse(sendResponse));
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
    void listTargetTabs(Number(message.windowId)).then(sendResponse).catch(toErrorResponse(sendResponse));
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
    await chrome.runtime.sendMessage({
      type: "ui.selection.cancelled",
      reason: "The selected page is no longer available.",
      tabId: tab?.id,
      windowId: tab?.windowId,
    }).catch(() => undefined);
    return;
  }
  try {
    const screenshot = message.mode === "image"
      ? await captureSelectedElement(tab, message.geometry, message.element.tagName)
      : undefined;
    const currentTab = await chrome.tabs.get(tab.id);
    if (currentTab.url !== message.pageUrl) throw new Error("The page navigated before the selection could be captured.");
    await chrome.storage.session.set({
      [selectionStorageKey(tab.id)]: {
        selectedElement: message.element,
        selectedElementPageUrl: message.pageUrl,
        selectedElementTabId: tab.id,
        ...(screenshot ? { selectedElementScreenshot: screenshot } : {}),
      } satisfies StoredSelection,
    });
    await chrome.runtime.sendMessage({
      type: "ui.element.selected",
      element: message.element,
      pageUrl: message.pageUrl,
      tabId: tab.id,
      windowId: tab.windowId,
      screenshot,
    }).catch(() => undefined);
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await chrome.runtime.sendMessage({
      type: "ui.selection.cancelled",
      reason,
      tabId: tab.id,
      windowId: tab.windowId,
    }).catch(() => undefined);
    return { ok: false, error: reason };
  }
}

async function currentSelection(targetTabId: number): Promise<Partial<StoredSelection>> {
  const tab = await getTargetTab(targetTabId);
  const key = selectionStorageKey(tab.id);
  const stored = await chrome.storage.session.get(key);
  const selection = parseStoredSelection(stored[key]);
  if (!selection || selection.selectedElementPageUrl !== tab.url) {
    await chrome.storage.session.remove(key);
    return {};
  }
  return selection;
}

async function clearSelectionForTab(tabId: number, windowId?: number) {
  if (!Number.isInteger(tabId)) return;
  await chrome.storage.session.remove(selectionStorageKey(tabId));
  await chrome.runtime.sendMessage({ type: "ui.selection.cleared", tabId, windowId }).catch(() => undefined);
}

async function clearStoredSelection(targetTabId?: number) {
  if (typeof targetTabId !== "number" || !Number.isInteger(targetTabId)) return;
  await sendPageMessage(targetTabId, { type: "page.selection.clear" }).catch(() => undefined);
  await chrome.storage.session.remove(selectionStorageKey(targetTabId));
}

function parseStoredSelection(value: unknown): StoredSelection | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<StoredSelection>;
  if (
    typeof candidate.selectedElementTabId !== "number"
    || typeof candidate.selectedElementPageUrl !== "string"
    || !candidate.selectedElement
  ) return null;
  return candidate as StoredSelection;
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

async function runTask(task: string, conversationId: string, history: ChatMessage[], targetTabId: number, windowId: number, screenshot?: { dataUrl?: string; title?: string; url?: string }): Promise<ServerMessage> {
  if (!task.trim()) throw new Error("Enter a task first.");
  if (!conversationId) throw new Error("The conversation is unavailable. Click New and try again.");
  const run = beginAgentRun(conversationId, targetTabId, windowId);
  try {
    const tab = await getTargetTab(targetTabId);
    if (tab.windowId !== windowId) throw new Error("The conversation page belongs to another browser window.");
    assertAgentRunActive(run);
    const snapshot = await sendPageMessage<PageSnapshot>(tab.id, {
      type: "page.snapshot",
      includePerformance: taskNeedsPerformance(task),
    });
    assertAgentRunActive(run);
    const stored = await currentSelection(tab.id);
    const selectionIsCurrent = stored.selectedElementPageUrl === tab.url && stored.selectedElementTabId === tab.id;
    const selectedElement = selectionIsCurrent ? stored.selectedElement : undefined;
    const selectedScreenshot = normalizeScreenshot(
      screenshot?.dataUrl?.startsWith("data:image/") ? screenshot : selectionIsCurrent ? stored.selectedElementScreenshot : undefined,
      tab,
    );
    if (selectedElement || selectedScreenshot) snapshot.context = { ...(selectedElement ? { selectedElement } : {}), ...(selectedScreenshot ? { screenshot: selectedScreenshot } : {}) };
    const pendingRun = {
      task,
      conversationId: conversationId || crypto.randomUUID(),
      history: history.slice(-20),
      snapshotId: snapshot.snapshotId,
      tabId: tab.id,
      windowId: tab.windowId,
      pageUrl: snapshot.url,
    };
    await pendingAgentRuns.save(pendingRun);
    try {
      const requestId = crypto.randomUUID();
      run.bridgeRequestId = requestId;
      const response = await requestBridge({
        id: requestId,
        type: "agent.run",
        task,
        snapshot,
        conversationId: pendingRun.conversationId,
        history: pendingRun.history,
      }, (event) => emitUiEvent(event, pendingRun.conversationId, pendingRun.tabId, pendingRun.windowId));
      assertAgentRunActive(run);
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
  } finally {
    finishAgentRun(run);
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
  const performance = await sendPageMessage<PerformanceSnapshot>(tab.id, { type: "page.performance" });
  return requestBridge({ id: crypto.randomUUID(), type: "repository.analyze", pageUrl, element, apiRequests: performance.apiRequests });
}

async function executePlan(plan: BrowserActionPlan, tabId: number) {
  return sendPageMessage(tabId, { type: "page.actions.execute", plan });
}

async function runAgentLoop(initialPlan: BrowserActionPlan, conversationId: string, targetTabId: number, windowId: number) {
  const pendingRun = await pendingAgentRuns.loadForPlan(initialPlan.snapshotId);
  if (
    pendingRun.conversationId !== conversationId
    || pendingRun.tabId !== targetTabId
    || pendingRun.windowId !== windowId
  ) throw new Error("This action plan belongs to a different conversation or page.");
  const run = beginAgentRun(pendingRun.conversationId, pendingRun.tabId, pendingRun.windowId);
  try {
    assertAgentRunActive(run);
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
    while (iteration < maxSteps && Date.now() - startedAt < timeoutMs) {
      assertAgentRunActive(run);
      const step = plan.steps[0];
      if (!step) throw new Error("The agent returned an empty action plan.");
      emitUiEvent(createEvent({ type: "action", action: step.action, targetRef: step.targetRef, status: "running", step: iteration + 1, detail: step.reason }), pendingRun.conversationId, pendingRun.tabId, pendingRun.windowId);
      let execution = await executePlanResilient({ ...plan, steps: [step] }, pendingRun.tabId);
      assertAgentRunActive(run);
      if (!execution.snapshot) execution = { ...execution, snapshot: await readSnapshot(pendingRun.tabId) };
      const observedSnapshot = execution.snapshot!;
      emitUiEvent(createEvent({ type: "action", action: step.action, targetRef: step.targetRef, status: execution.ok ? "success" : "failed", step: iteration + 1, detail: execution.error }), pendingRun.conversationId, pendingRun.tabId, pendingRun.windowId);
      const verification = execution.verification;
      emitUiEvent(createEvent({ type: "verify", success: Boolean(verification?.success ?? execution.ok), summary: verification?.summary ?? execution.error ?? "Action observation completed.", changes: verification?.changes, changedRefs: verification?.diff.changedFingerprints, step: iteration + 1 }), pendingRun.conversationId, pendingRun.tabId, pendingRun.windowId);
      if (!execution.ok) failures += 1;
      else failures = 0;
      iteration += 1;
      if (failures >= 2) throw new Error("The agent stopped after two consecutive verification failures.");
      const loop: AgentLoopContext = {
        runId, iteration, maxSteps, timeoutMs, startedAt,
        lastAction: step,
        ...(verification ? { lastVerification: verification } : {}),
      };
      const requestId = crypto.randomUUID();
      run.bridgeRequestId = requestId;
      const response = await requestBridge({
        id: requestId, type: "agent.run", task: pendingRun.task, snapshot: observedSnapshot,
        conversationId: pendingRun.conversationId, history: pendingRun.history, loop,
      }, (event) => emitUiEvent(event, pendingRun.conversationId, pendingRun.tabId, pendingRun.windowId));
      assertAgentRunActive(run);
      if (response.type === "agent.error") throw new Error(response.error);
      if (response.type !== "agent.result") throw new Error("Unexpected agent loop response.");
      if (response.decision.kind === "complete") {
        return {
          ok: true,
          status: "completed" as const,
          answer: response.decision.summary,
          evidence: response.decision.evidence,
          steps: iteration,
        };
      }
      if (response.decision.kind === "needs_user") {
        return {
          ok: true,
          status: "needs_user" as const,
          question: response.decision.question,
          steps: iteration,
        };
      }
      if (response.decision.kind === "blocked") {
        return {
          ok: false,
          status: "blocked" as const,
          error: response.decision.reason,
          recoverable: response.decision.recoverable,
          steps: iteration,
        };
      }
      if (response.decision.kind === "answer") {
        return {
          ok: false,
          status: "blocked" as const,
          error: "The agent returned an answer after browser execution instead of verifying the whole task.",
          recoverable: true,
          steps: iteration,
        };
      }
      if (iteration >= maxSteps || Date.now() - startedAt >= timeoutMs) throw new Error(`The agent stopped at its ${iteration >= maxSteps ? "step" : "time"} budget.`);
      plan = response.decision;
    }
    throw new Error("The agent stopped at its time budget.");
  } finally {
    finishAgentRun(run);
    await sendPageMessage(pendingRun.tabId, { type: "page.agent.activity", active: false }).catch(() => undefined);
    await pendingAgentRuns.clearForSnapshot(initialPlan.snapshotId);
  }
}

function beginAgentRun(conversationId: string, tabId: number, windowId: number): ActiveAgentRun {
  if (activeAgentRun) throw new Error("Another agent run is already active.");
  if (!conversationId || !Number.isInteger(tabId) || !Number.isInteger(windowId)) {
    throw new Error("The conversation scope is invalid. Click New and try again.");
  }
  const run = { conversationId, tabId, windowId, cancelled: false };
  activeAgentRun = run;
  return run;
}

function finishAgentRun(run: ActiveAgentRun) {
  if (activeAgentRun === run) activeAgentRun = null;
}

function assertAgentRunActive(run: ActiveAgentRun) {
  if (run.cancelled || activeAgentRun !== run) throw new Error("Agent run stopped.");
}

async function stopActiveAgentRun(conversationId: string, targetTabId?: number, windowId?: number) {
  const run = activeAgentRun;
  if (
    !run
    || (conversationId && run.conversationId !== conversationId)
    || (Number.isInteger(targetTabId) && run.tabId !== targetTabId)
    || (Number.isInteger(windowId) && run.windowId !== windowId)
  ) return { ok: true, stopped: false };
  run.cancelled = true;
  await sendPageMessage(run.tabId, { type: "page.agent.activity", active: false }).catch(() => undefined);
  await pendingAgentRuns.clearForConversation(run.conversationId);
  if (run.bridgeRequestId) {
    await requestBridge({
      id: crypto.randomUUID(),
      type: "agent.cancel",
      requestId: run.bridgeRequestId,
      conversationId: run.conversationId,
    }).catch(() => undefined);
  }
  return { ok: true, stopped: true };
}

async function executePlanResilient(plan: BrowserActionPlan, tabId: number): Promise<ActionExecutionResult> {
  try { return await executePlan(plan, tabId) as ActionExecutionResult; }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/message port closed|receiving end does not exist|context invalidated|frame was removed/iu.test(message)) throw error;
    await waitForTabReady(tabId);
    const snapshot = await readSnapshot(tabId);
    const diff = { urlChanged: true, titleChanged: false, addedFingerprints: [], removedFingerprints: [], changedFingerprints: [], summary: ["The page navigated and a new document was observed."] };
    return {
      ok: true,
      results: [{ action: plan.steps[0]?.action ?? "click", ok: true }],
      snapshot,
      verification: {
        success: false,
        summary: "The page navigated; the new page must be checked before the task can complete.",
        changes: diff.summary,
        diff,
      },
    };
  }
}

async function readSnapshot(tabId: number): Promise<PageSnapshot> {
  await getTargetTab(tabId);
  return sendPageMessage<PageSnapshot>(tabId, { type: "page.snapshot" });
}

function emitUiEvent(event: AgentEvent, conversationId: string, targetTabId: number, windowId: number) {
  void chrome.runtime.sendMessage({
    type: "ui.agent.event",
    conversationId,
    targetTabId,
    windowId,
    event,
  }).catch(() => undefined);
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
