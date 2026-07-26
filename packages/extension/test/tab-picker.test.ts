import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserTabTarget } from "@auto-page-agent/shared";
import { orderTabsForPicker } from "../src/sidepanel/tab-picker.js";

function tab(tabId: number): BrowserTabTarget {
  return {
    tabId,
    windowId: 1,
    title: `Tab ${tabId}`,
    url: `https://example.com/${tabId}`,
    active: false,
  };
}

test("puts the current page first and the selected conversation page second", () => {
  const result = orderTabsForPicker([tab(1), tab(2), tab(3), tab(4)], 3, 2);

  assert.deepEqual(result.map((item) => item.tabId), [3, 2, 1, 4]);
});

test("does not duplicate a page that is both current and selected", () => {
  const result = orderTabsForPicker([tab(1), tab(2), tab(3)], 2, 2);

  assert.deepEqual(result.map((item) => item.tabId), [2, 1, 3]);
});

test("skips priority ids that are not present in the available tabs", () => {
  const result = orderTabsForPicker([tab(1), tab(2), tab(3)], 8, 9);

  assert.deepEqual(result.map((item) => item.tabId), [1, 2, 3]);
});
