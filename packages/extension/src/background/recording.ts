import type { RecordedBrowserAction, RecordedPageScreenshot } from "@auto-page-agent/shared";
import { captureRecordingScreenshot as captureFrame } from "./screenshot.js";
import { getTargetTab, sendPageMessage, waitForTabReady } from "./tabs.js";

const RECORDING_KEY = "automationRecording";

export interface RecordingState {
  active: boolean;
  tabId: number;
  startedAt: number;
  startUrl: string;
  actions: RecordedBrowserAction[];
  screenshots: RecordedPageScreenshot[];
}

export async function startRecording(targetTabId: number) {
  const tab = await getTargetTab(targetTabId);
  const state: RecordingState = { active: true, tabId: tab.id, startedAt: Date.now(), startUrl: tab.url!, actions: [], screenshots: [] };
  await chrome.storage.session.set({ [RECORDING_KEY]: state });
  await sendPageMessage(tab.id, { type: "page.recording.start" });
  await captureRecordingFrame(tab.id, "start");
  return await getRecordingState() ?? state;
}

export async function stopRecording() {
  const state = await getRecordingState();
  if (!state) return { active: false, actions: [] };
  await chrome.tabs.sendMessage(state.tabId, { type: "page.recording.stop" }).catch(() => undefined);
  const stopped = { ...state, active: false };
  await chrome.storage.session.set({ [RECORDING_KEY]: stopped });
  return stopped;
}

export async function replayRecording(actions: RecordedBrowserAction[], targetTabId: number) {
  if (!Array.isArray(actions) || !actions.length) throw new Error("There are no recorded actions to replay.");
  if (actions.length > 100) throw new Error("At most 100 actions can be replayed.");
  const tab = await getTargetTab(targetTabId);
  await sendPageMessage(tab.id, { type: "page.agent.activity", active: true }).catch(() => undefined);
  try {
    const results: Array<{ action: string; ok: true }> = [];
    for (const action of actions) {
      if (action.action === "screenshot") continue;
      if (action.action === "navigate") {
        await chrome.tabs.update(tab.id, { url: action.url });
        await waitForTabReady(tab.id);
        results.push({ action: "navigate", ok: true });
        continue;
      }
      const response = await sendPageMessage<{ ok?: boolean; results?: Array<{ action: string; ok: true }>; error?: string }>(
        tab.id,
        { type: "page.recording.replay", actions: [action] },
      );
      if (!response.ok) throw new Error(response.error || `Recorded ${action.action} step failed.`);
      results.push(...(response.results ?? [{ action: action.action, ok: true }]));
    }
    return { ok: true, results };
  } finally {
    await sendPageMessage(tab.id, { type: "page.agent.activity", active: false }).catch(() => undefined);
  }
}

export async function resumeRecordingForSender(tabId: number | undefined) {
  if (typeof tabId !== "number") return;
  const state = await getRecordingState();
  if (state?.active && state.tabId === tabId) {
    await sendPageMessage(tabId, { type: "page.recording.start" }).catch(() => undefined);
  }
}

export async function appendRecordedAction(action: RecordedBrowserAction, tabId: number | undefined) {
  if (typeof tabId !== "number") return;
  let actionId = "";
  await mutateRecording(async (state) => {
    if (!state.active || state.tabId !== tabId || state.actions.length >= 100) return state;
    const sanitized: RecordedBrowserAction = {
      ...action,
      id: crypto.randomUUID(),
      value: action.sensitive ? undefined : action.value?.slice(0, 4_000),
      timestamp: Date.now(),
    };
    actionId = sanitized.id;
    const actions = [...state.actions];
    const last = actions.at(-1);
    const replaceLast = last && (
      ((sanitized.action === "fill" || sanitized.action === "select") && last.action === sanitized.action && last.selector === sanitized.selector)
      || (sanitized.action === "scroll" && last.action === "scroll" && sanitized.selector === last.selector && sanitized.timestamp - last.timestamp < 2_000)
    );
    if (replaceLast) {
      actionId = last.id;
      actions[actions.length - 1] = { ...sanitized, id: last.id };
    } else actions.push(sanitized);
    return { ...state, actions };
  });
  if (actionId && ["click", "submit"].includes(action.action)) {
    setTimeout(() => { void captureRecordingFrame(tabId, "action", actionId); }, 450);
  }
}

export async function getRecordingState(): Promise<RecordingState | undefined> {
  const stored = await chrome.storage.session.get(RECORDING_KEY);
  const state = stored[RECORDING_KEY] as RecordingState | undefined;
  return state ? { ...state, screenshots: state.screenshots ?? [] } : undefined;
}

export async function recordNavigation(tabId: number, url: string, title: string) {
  if (!/^https?:\/\//u.test(url)) return;
  let appended = false;
  await mutateRecording(async (state) => {
    if (!state.active || state.tabId !== tabId) return state;
    const lastUrl = state.actions.at(-1)?.url ?? state.startUrl;
    if (lastUrl === url) return state;
    appended = true;
    const navigation: RecordedBrowserAction = {
      id: crypto.randomUUID(),
      action: "navigate",
      url,
      label: title || url,
      sensitive: false,
      timestamp: Date.now(),
    };
    return {
      ...state,
      actions: [...state.actions, navigation].slice(0, 100),
    };
  });
  if (appended) await captureRecordingFrame(tabId, "navigation");
}

export async function captureRecordingFrame(
  tabId: number,
  reason: RecordedPageScreenshot["reason"] = "manual",
  actionId?: string,
) {
  const state = await getRecordingState();
  if (!state?.active || state.tabId !== tabId || state.screenshots.length >= 12) return state;
  const previous = state.screenshots.at(-1);
  if (reason === "action" && previous && Date.now() - previous.timestamp < 1_200) return state;
  const frame = await captureFrame(tabId).catch(() => undefined);
  if (!frame) return state;
  await mutateRecording(async (current) => {
    if (!current.active || current.tabId !== tabId || current.screenshots.length >= 12) return current;
    return {
      ...current,
      screenshots: [...current.screenshots, {
        id: crypto.randomUUID(),
        ...frame,
        timestamp: Date.now(),
        reason,
        ...(actionId ? { actionId } : {}),
      }],
    };
  });
  return getRecordingState();
}

let mutationQueue: Promise<void> = Promise.resolve();

async function mutateRecording(update: (state: RecordingState) => Promise<RecordingState> | RecordingState) {
  const operation = mutationQueue.then(async () => {
    const state = await getRecordingState();
    if (!state) return;
    const next = await update({ ...state, screenshots: state.screenshots ?? [] });
    await chrome.storage.session.set({ [RECORDING_KEY]: next });
    void chrome.runtime.sendMessage({
      type: "ui.recording.updated",
      actions: next.actions,
      screenshots: next.screenshots,
    }).catch(() => undefined);
  });
  mutationQueue = operation.catch(() => undefined);
  await operation;
}
