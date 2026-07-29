import type { ActionExecutionResult, AgentDecision, AgentEvent, AgentLoopContext, AutomationSkillDraft, BrowserActionPlan, ChatMessage, ConversationLog, ElementSelectionGeometry, InspectedElement, PageSnapshot, PerformanceSnapshot, RecordedBrowserAction, ServerMessage, SkillExportBundle, SkillSummaryRequest } from "@auto-page-agent/shared";
import { reconnectBridge, requestBridge } from "./background/bridge-client.js";
import { PendingAgentRunStore, type PendingAgentRun } from "./background/pending-agent-run.js";
import {
  appendRecordedAction,
  captureRecordingFrame,
  getRecordingState,
  recordNavigation,
  replayRecording,
  resumeRecordingForSender,
  startRecording,
  stopRecording,
} from "./background/recording.js";
import {
  captureAutomaticScreenshot,
  captureScreenshot,
  captureSelectedElement,
  MAX_SCREENSHOT_DATA_URL_LENGTH,
} from "./background/screenshot.js";
import {
  attachViewportScreenshot,
  canCaptureAutomaticScreenshot,
  shouldCaptureInitialVisualContext,
} from "./background/visual-recovery.js";
import {
  classifyReobserveError,
  classifyReobserveExecution,
  consumeReobserveStep,
  type ReobserveSignal,
} from "./background/reobserve.js";
import {
  getBlockedRecoveryBoundary,
  waitForPageDecisionReadiness,
} from "./background/page-readiness.js";
import {
  createPopupDismissStepAfterOptionSelection,
  rebindQueuedStep,
} from "./background/step-queue.js";
import { dispatchTrustedViewportClick } from "./background/trusted-click.js";
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
  if (changeInfo.status === "complete" && tab.url) void recordNavigation(tabId, tab.url, tab.title ?? "");
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
  if (message?.type === "page.dismiss.trusted-click") {
    const tabId = _sender.tab?.id;
    if (
      typeof tabId !== "number"
      || _sender.frameId !== 0
      || activeAgentRun?.tabId !== tabId
    ) {
      sendResponse({ ok: false, error: "Trusted popup dismissal is available only to the active top-frame agent run." });
      return false;
    }
    void dispatchTrustedViewportClick(tabId, {
      x: Number(message.x),
      y: Number(message.y),
    }).then(() => sendResponse({ ok: true })).catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return true;
  }
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
  if (message?.type === "ui.bridge.reconnect") {
    reconnectBridge();
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
  if (message?.type === "ui.logs.list") {
    void requestBridge({ id: crypto.randomUUID(), type: "log.list" }).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.logs.get") {
    void requestBridge({
      id: crypto.randomUUID(),
      type: "log.get",
      conversationId: String(message.conversationId ?? ""),
    }).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.logs.save") {
    void requestBridge({
      id: crypto.randomUUID(),
      type: "log.save",
      log: message.log as ConversationLog,
    }).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.logs.delete") {
    const conversationId = String(message.conversationId ?? "");
    void requestBridge({
      id: crypto.randomUUID(),
      type: "log.delete",
      conversationId,
    }).then(async (response) => {
      await pendingAgentRuns.clearForConversation(conversationId);
      await requestBridge({ id: crypto.randomUUID(), type: "agent.reset", conversationId });
      sendResponse(response);
    }).catch(toErrorResponse(sendResponse));
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
      typeof message.selectedSkillSlug === "string" ? message.selectedSkillSlug : undefined,
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
  if (message?.type === "ui.recording.screenshot") {
    void captureRecordingFrame(Number(message.targetTabId), "manual").then(sendResponse).catch(toErrorResponse(sendResponse));
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
  if (message?.type === "ui.skill.delete") {
    void requestBridge({ id: crypto.randomUUID(), type: "skill.delete", slug: String(message.slug ?? "") }).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.skill.export") {
    void requestBridge({ id: crypto.randomUUID(), type: "skill.export", slug: String(message.slug ?? "") }).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.skill.import") {
    void requestBridge({ id: crypto.randomUUID(), type: "skill.import", bundle: message.bundle as SkillExportBundle }).then(sendResponse).catch(toErrorResponse(sendResponse));
    return true;
  }
  if (message?.type === "ui.skill.summarize") {
    void requestBridge({ id: crypto.randomUUID(), type: "skill.summarize", input: message.input as SkillSummaryRequest }).then(sendResponse).catch(toErrorResponse(sendResponse));
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

async function runTask(
  task: string,
  conversationId: string,
  history: ChatMessage[],
  targetTabId: number,
  windowId: number,
  screenshot?: { dataUrl?: string; title?: string; url?: string },
  selectedSkillSlug?: string,
): Promise<ServerMessage> {
  if (!task.trim()) throw new Error("Enter a task first.");
  if (!conversationId) throw new Error("The conversation is unavailable. Click New and try again.");
  const run = beginAgentRun(conversationId, targetTabId, windowId);
  try {
    const tab = await getTargetTab(targetTabId);
    if (tab.windowId !== windowId) throw new Error("The conversation page belongs to another browser window.");
    assertAgentRunActive(run);
    let snapshot = await sendPageMessage<PageSnapshot>(tab.id, {
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
    if (shouldCaptureInitialVisualContext(snapshot)) {
      const captured = await captureAutomaticScreenshot(tab.id, snapshot).catch(() => undefined);
      if (captured) snapshot = attachViewportScreenshot(snapshot, captured);
    }
    const pendingRun = {
      task,
      conversationId: conversationId || crypto.randomUUID(),
      history: history.slice(-20),
      snapshotId: snapshot.snapshotId,
      tabId: tab.id,
      windowId: tab.windowId,
      pageUrl: snapshot.url,
      ...(selectedSkillSlug ? { selectedSkillSlug } : {}),
    };
    await pendingAgentRuns.save(pendingRun);
    try {
      const requestDecision = async (currentSnapshot: PageSnapshot) => {
        const requestId = crypto.randomUUID();
        run.bridgeRequestId = requestId;
        return requestBridge({
          id: requestId,
          type: "agent.run",
          task,
          snapshot: currentSnapshot,
          conversationId: pendingRun.conversationId,
          history: pendingRun.history,
          ...(pendingRun.selectedSkillSlug ? { selectedSkillSlug: pendingRun.selectedSkillSlug } : {}),
        }, (event) => emitUiEvent(event, pendingRun.conversationId, pendingRun.tabId, pendingRun.windowId));
      };
      let response = await requestDecision(snapshot);
      assertAgentRunActive(run);
      if (response.type === "agent.result" && response.decision.kind === "blocked") {
        const readySnapshot = await waitForPageDecisionReadiness(
          snapshot,
          () => readSnapshot(tab.id),
          { timeoutMs: 6_000 },
        );
        assertAgentRunActive(run);
        if (readySnapshot) {
          snapshot = {
            ...readySnapshot,
            ...(snapshot.context ? { context: snapshot.context } : {}),
          };
          pendingRun.snapshotId = snapshot.snapshotId;
          pendingRun.pageUrl = snapshot.url;
          await pendingAgentRuns.save(pendingRun);
          response = await requestDecision(snapshot);
          assertAgentRunActive(run);
        }
      }
      if (
        response.type === "agent.result"
        && response.decision.kind === "blocked"
        && canCaptureAutomaticScreenshot(snapshot)
      ) {
        const captured = await captureAutomaticScreenshot(tab.id, snapshot).catch(() => undefined);
        assertAgentRunActive(run);
        if (captured) {
          snapshot = attachViewportScreenshot(snapshot, captured);
          response = await requestDecision(snapshot);
          assertAgentRunActive(run);
        }
      }
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
    await sendPageMessage(pendingRun.tabId, { type: "page.agent.activity", active: true }).catch(() => undefined);
    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    const maxSteps = 8;
    const timeoutMs = 90_000;
    let iteration = 0;
    let failures = 0;
    const recoveryState = {
      completionAttempts: 0,
      blockedBoundaries: new Set<string>(),
      visualBoundaries: new Set<string>(),
    };
    let plan = initialPlan;
    let pendingSteps = [...initialPlan.steps];
    if (initialTab.url !== pendingRun.pageUrl) {
      const signal: ReobserveSignal = {
        reason: "page_url_changed",
        summary: "The target page navigated after the plan was created, so the stale plan was discarded.",
        actionMayHaveExecuted: false,
      };
      const snapshot = await reobservePage(pendingRun.tabId);
      const decision = await requestContinuation(snapshot, {
        runId,
        iteration,
        maxSteps,
        timeoutMs,
        startedAt,
        remainingPlan: summarizePendingSteps(pendingSteps),
        reobserve: signal,
      }, pendingRun, run, recoveryState);
      const terminal = terminalAgentResult(decision, iteration);
      if (terminal) return terminal;
      if (decision.kind !== "action_plan") throw new Error("Unexpected agent continuation.");
      plan = decision;
      pendingSteps = [...decision.steps];
    }
    while (iteration < maxSteps && Date.now() - startedAt < timeoutMs) {
      assertAgentRunActive(run);
      const step = pendingSteps[0];
      if (!step) throw new Error("The agent returned an empty action plan.");
      emitUiEvent(createEvent({ type: "action", action: step.action, targetRef: step.targetRef, status: "running", step: iteration + 1, detail: step.reason }), pendingRun.conversationId, pendingRun.tabId, pendingRun.windowId);
      const outcome = await executePlanResilient({ ...plan, steps: [step] }, pendingRun.tabId);
      assertAgentRunActive(run);
      if (outcome.kind === "reobserve") {
        failures = 0;
        iteration = consumeReobserveStep(iteration, outcome.signal);
        const displayStep = outcome.signal.actionMayHaveExecuted ? iteration : iteration + 1;
        emitUiEvent(createEvent({
          type: "action",
          action: step.action,
          targetRef: step.targetRef,
          status: "pending",
          step: displayStep,
          detail: `${outcome.signal.summary} Replanning from the new page.`,
        }), pendingRun.conversationId, pendingRun.tabId, pendingRun.windowId);
        const loop: AgentLoopContext = {
          runId, iteration, maxSteps, timeoutMs, startedAt,
          lastAction: step,
          remainingPlan: summarizePendingSteps(pendingSteps),
          reobserve: outcome.signal,
        };
        const decision = await requestContinuation(outcome.snapshot, loop, pendingRun, run, recoveryState);
        const terminal = terminalAgentResult(decision, iteration);
        if (terminal) return terminal;
        if (decision.kind !== "action_plan") throw new Error("Unexpected agent continuation.");
        if (iteration >= maxSteps || Date.now() - startedAt >= timeoutMs) {
          throw new Error(`The agent stopped at its ${iteration >= maxSteps ? "step" : "time"} budget.`);
        }
        plan = decision;
        pendingSteps = [...decision.steps];
        continue;
      }
      let execution = outcome.execution;
      if (!execution.snapshot) execution = { ...execution, snapshot: await readSnapshot(pendingRun.tabId) };
      const observedSnapshot = execution.snapshot!;
      emitUiEvent(createEvent({ type: "action", action: step.action, targetRef: step.targetRef, status: execution.ok ? "success" : "failed", step: iteration + 1, detail: execution.error }), pendingRun.conversationId, pendingRun.tabId, pendingRun.windowId);
      const verification = execution.verification;
      emitUiEvent(createEvent({ type: "verify", success: Boolean(verification?.success ?? execution.ok), summary: verification?.summary ?? execution.error ?? "Action observation completed.", changes: verification?.changes, changedRefs: verification?.diff.changedFingerprints, step: iteration + 1 }), pendingRun.conversationId, pendingRun.tabId, pendingRun.windowId);
      if (!execution.ok) failures += 1;
      else failures = 0;
      iteration += 1;
      if (failures >= 2) throw new Error("The agent stopped after two consecutive verification failures.");
      const baseLoop: AgentLoopContext = {
        runId, iteration, maxSteps, timeoutMs, startedAt,
        lastAction: step,
        ...(verification ? { lastVerification: verification } : {}),
      };
      const verified = execution.ok && (verification?.success ?? true);
      const pageBranched = verification?.diff.urlChanged === true
        || verification?.routeTransitioned === true;
      pendingSteps = pendingSteps.slice(1);
      const popupDismissStep = verified && !pageBranched
        ? createPopupDismissStepAfterOptionSelection(step, pendingSteps, observedSnapshot)
        : undefined;
      if (popupDismissStep) pendingSteps = [popupDismissStep, ...pendingSteps];
      baseLoop.remainingPlan = summarizePendingSteps(pendingSteps);
      if (verified && !pageBranched && pendingSteps.length) {
        const rebound = rebindQueuedStep(pendingSteps[0]!, observedSnapshot);
        if (rebound) {
          pendingSteps = [rebound, ...pendingSteps.slice(1)];
          plan = { ...plan, snapshotId: observedSnapshot.snapshotId, steps: pendingSteps };
          continue;
        }
      }
      const reobserve = pageBranched
        ? verification?.diff.urlChanged
          ? {
              reason: "page_url_changed" as const,
              summary: "The page navigated after the action, so the remaining queued targets were discarded.",
              actionMayHaveExecuted: true,
            }
          : {
              reason: "page_context_changed" as const,
              summary: "The SPA route changed its page context, so the remaining queued targets were discarded.",
              actionMayHaveExecuted: true,
            }
        : verified && pendingSteps.length
          ? {
              reason: "snapshot_expired" as const,
              summary: "The next queued target could not be uniquely rebound in the latest snapshot.",
              actionMayHaveExecuted: false,
            }
          : undefined;
      const decision = await requestContinuation(observedSnapshot, {
        ...baseLoop,
        ...(reobserve ? { reobserve } : {}),
      }, pendingRun, run, recoveryState);
      const terminal = terminalAgentResult(decision, iteration);
      if (terminal) return terminal;
      if (decision.kind !== "action_plan") throw new Error("Unexpected agent continuation.");
      if (iteration >= maxSteps || Date.now() - startedAt >= timeoutMs) throw new Error(`The agent stopped at its ${iteration >= maxSteps ? "step" : "time"} budget.`);
      plan = decision;
      pendingSteps = [...decision.steps];
    }
    throw new Error("The agent stopped at its time budget.");
  } finally {
    finishAgentRun(run);
    await sendPageMessage(pendingRun.tabId, { type: "page.agent.activity", active: false }).catch(() => undefined);
    await pendingAgentRuns.clearForSnapshot(initialPlan.snapshotId);
  }
}

function summarizePendingSteps(steps: BrowserActionPlan["steps"]): NonNullable<AgentLoopContext["remainingPlan"]> {
  return steps.map(({ action, reason }) => ({ action, reason }));
}

async function requestContinuation(
  snapshot: PageSnapshot,
  loop: AgentLoopContext,
  pendingRun: PendingAgentRun,
  run: ActiveAgentRun,
  recoveryState: {
    completionAttempts: number;
    blockedBoundaries: Set<string>;
    visualBoundaries: Set<string>;
  },
): Promise<AgentDecision> {
  const requestId = crypto.randomUUID();
  run.bridgeRequestId = requestId;
  const response = await requestBridge({
    id: requestId,
    type: "agent.run",
    task: pendingRun.task,
    snapshot,
    conversationId: pendingRun.conversationId,
    history: pendingRun.history,
    loop,
    ...(pendingRun.selectedSkillSlug ? { selectedSkillSlug: pendingRun.selectedSkillSlug } : {}),
  }, (event) => emitUiEvent(event, pendingRun.conversationId, pendingRun.tabId, pendingRun.windowId));
  assertAgentRunActive(run);
  if (response.type === "agent.error") throw new Error(response.error);
  if (response.type !== "agent.result") throw new Error("Unexpected agent loop response.");
  if (response.decision.kind === "blocked") {
    const boundary = getBlockedRecoveryBoundary(loop);
    const remainingMs = loop.timeoutMs - (Date.now() - loop.startedAt);
    if (boundary && !recoveryState.blockedBoundaries.has(boundary) && remainingMs > 500) {
      recoveryState.blockedBoundaries.add(boundary);
      const readySnapshot = await waitForPageDecisionReadiness(
        snapshot,
        () => readSnapshot(pendingRun.tabId),
        { timeoutMs: Math.min(6_000, remainingMs - 250) },
      );
      assertAgentRunActive(run);
      if (readySnapshot) {
        return requestContinuation(readySnapshot, {
          ...loop,
          reobserve: {
            reason: "page_content_changed",
            summary: "The page changed after an initially blocked decision, so fresh refs must be used to replan.",
            actionMayHaveExecuted: false,
          },
        }, pendingRun, run, recoveryState);
      }
    }
    if (
      boundary
      && !recoveryState.visualBoundaries.has(boundary)
      && canCaptureAutomaticScreenshot(snapshot)
      && remainingMs > 500
    ) {
      recoveryState.visualBoundaries.add(boundary);
      const captured = await captureAutomaticScreenshot(pendingRun.tabId, snapshot).catch(() => undefined);
      assertAgentRunActive(run);
      if (captured) {
        return requestContinuation(attachViewportScreenshot(snapshot, captured), {
          ...loop,
          visualRecovery: {
            reason: "viewport_screenshot",
            summary: "A bounded viewport screenshot was attached after DOM readiness produced no actionable change.",
          },
        }, pendingRun, run, recoveryState);
      }
    }
  }
  if (response.decision.kind === "blocked" && response.decision.code === "completion_evidence_missing") {
    if (recoveryState.completionAttempts < 1) {
      recoveryState.completionAttempts += 1;
      return requestContinuation(snapshot, {
        ...loop,
        completionEvidenceFailure: {
          reason: response.decision.reason,
          unmatchedEvidence: response.decision.unmatchedEvidence ?? [],
        },
      }, pendingRun, run, recoveryState);
    }
    return {
      ...response.decision,
      reason: "操作已提交，但当前页面没有可验证的成功结果，暂不能确认完成。",
    };
  }
  return response.decision;
}

type AgentLoopResult =
  | { ok: true; status: "completed"; answer: string; evidence: string[]; steps: number }
  | { ok: true; status: "needs_user"; question: string; options?: string[]; recommendedOption?: string; steps: number }
  | { ok: false; status: "blocked"; error: string; recoverable: boolean; steps: number };

function terminalAgentResult(decision: AgentDecision, steps: number): AgentLoopResult | null {
  if (decision.kind === "complete") {
    return { ok: true, status: "completed", answer: decision.summary, evidence: decision.evidence, steps };
  }
  if (decision.kind === "needs_user") {
    return {
      ok: true,
      status: "needs_user",
      question: decision.question,
      ...(decision.options?.length ? { options: decision.options } : {}),
      ...(decision.recommendedOption ? { recommendedOption: decision.recommendedOption } : {}),
      steps,
    };
  }
  if (decision.kind === "blocked") {
    return { ok: false, status: "blocked", error: decision.reason, recoverable: decision.recoverable, steps };
  }
  if (decision.kind === "answer") {
    return {
      ok: false,
      status: "blocked",
      error: "The agent returned an answer after browser execution instead of verifying the whole task.",
      recoverable: true,
      steps,
    };
  }
  return null;
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

type PlanExecutionOutcome =
  | { kind: "executed"; execution: ActionExecutionResult }
  | { kind: "reobserve"; snapshot: PageSnapshot; signal: ReobserveSignal };

async function executePlanResilient(plan: BrowserActionPlan, tabId: number): Promise<PlanExecutionOutcome> {
  try {
    const execution = await executePlan(plan, tabId) as ActionExecutionResult;
    const signal = classifyReobserveExecution(execution);
    if (signal) {
      return { kind: "reobserve", snapshot: await reobservePage(tabId), signal };
    }
    return { kind: "executed", execution };
  }
  catch (error) {
    const signal = classifyReobserveError(error);
    if (!signal) throw error;
    return { kind: "reobserve", snapshot: await reobservePage(tabId), signal };
  }
}

async function reobservePage(tabId: number): Promise<PageSnapshot> {
  await waitForTabReady(tabId);
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await readSnapshot(tabId);
    } catch (error) {
      lastError = error;
      if (!classifyReobserveError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw lastError;
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
