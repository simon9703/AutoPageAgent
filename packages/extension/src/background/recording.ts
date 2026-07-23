import type { RecordedBrowserAction } from "@auto-page-agent/shared";
import { getTargetTab, sendPageMessage } from "./tabs.js";

const RECORDING_KEY = "automationRecording";

export interface RecordingState {
  active: boolean;
  tabId: number;
  startedAt: number;
  startUrl: string;
  actions: RecordedBrowserAction[];
}

export async function startRecording(targetTabId: number) {
  const tab = await getTargetTab(targetTabId);
  const state: RecordingState = { active: true, tabId: tab.id, startedAt: Date.now(), startUrl: tab.url!, actions: [] };
  await chrome.storage.session.set({ [RECORDING_KEY]: state });
  await sendPageMessage(tab.id, { type: "page.recording.start" });
  return state;
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
    return await sendPageMessage(tab.id, { type: "page.recording.replay", actions });
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

export async function getRecordingState(): Promise<RecordingState | undefined> {
  const stored = await chrome.storage.session.get(RECORDING_KEY);
  return stored[RECORDING_KEY] as RecordingState | undefined;
}
