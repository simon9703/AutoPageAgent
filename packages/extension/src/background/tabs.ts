import type { BrowserTabTarget } from "@auto-page-agent/shared";

export async function getTargetTab(tabId: number): Promise<chrome.tabs.Tab & { id: number }> {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error("Choose a target page before running the agent.");
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new Error("The target page was closed. Choose another tab.");
  }
  if (typeof tab.id !== "number" || !/^https?:/u.test(tab.url ?? "")) {
    throw new Error("The target must be an open http(s) page.");
  }
  return tab as chrome.tabs.Tab & { id: number };
}

export async function listTargetTabs(): Promise<{ tabs: BrowserTabTarget[]; activeTabId?: number }> {
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

export async function activateTargetTab(targetTabId: number): Promise<{ ok: true }> {
  const tab = await getTargetTab(targetTabId);
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
  return { ok: true };
}

export async function sendPageMessage<T = unknown>(tabId: number, message: unknown): Promise<T> {
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

export async function waitForTabReady(tabId: number, timeoutMs = 8_000): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }
    function onUpdated(updatedTabId: number, info: chrome.tabs.TabChangeInfo) {
      if (updatedTabId === tabId && info.status === "complete") done();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function getActiveTab(): Promise<chrome.tabs.Tab & { id: number }> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || typeof tab.id !== "number" || !/^https?:/u.test(tab.url ?? "")) {
    throw new Error("Open an http(s) page before running the agent.");
  }
  return tab as chrome.tabs.Tab & { id: number };
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

function isMissingPageReceiver(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /could not establish connection|receiving end does not exist/iu.test(message);
}
