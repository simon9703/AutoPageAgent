import type { BrowserTabTarget } from "@auto-page-agent/shared";

export function orderTabsForPicker(
  tabs: BrowserTabTarget[],
  activeTabId: number | null,
  targetTabId: number | null,
): BrowserTabTarget[] {
  const priorityIds = [activeTabId, targetTabId]
    .filter((tabId): tabId is number => typeof tabId === "number")
    .filter((tabId, index, values) => values.indexOf(tabId) === index);
  const priorityTabs = priorityIds
    .map((tabId) => tabs.find((tab) => tab.tabId === tabId))
    .filter((tab): tab is BrowserTabTarget => Boolean(tab));
  const priorityIdSet = new Set(priorityTabs.map((tab) => tab.tabId));

  return [...priorityTabs, ...tabs.filter((tab) => !priorityIdSet.has(tab.tabId))];
}
