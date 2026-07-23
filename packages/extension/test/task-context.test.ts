import assert from "node:assert/strict";
import test from "node:test";
import { taskNeedsPerformance } from "../src/background/task-context.js";

test("performance context is collected only for explicit performance tasks", () => {
  assert.equal(taskNeedsPerformance("分析当前页面性能和 API 请求"), true);
  assert.equal(taskNeedsPerformance("Check the network waterfall and TTFB"), true);
  assert.equal(taskNeedsPerformance("搜索 BTC 并打开详情页"), false);
  assert.equal(taskNeedsPerformance("Fill in the daily report and save it"), false);
});
