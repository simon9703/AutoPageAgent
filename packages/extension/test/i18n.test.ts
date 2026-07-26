import assert from "node:assert/strict";
import test from "node:test";
import { zhCN } from "../src/sidepanel/i18n/locales/zh-CN.js";

test("side-panel Chinese translations use stable semantic keys", () => {
  assert.equal(zhCN.action.new, "新建");
  assert.equal(zhCN.prompt.tips, "提问当前页面、选择元素作为上下文，或运行可复用的 Skill。");
  assert.equal(zhCN.skills.market, "Skills 市场");
  assert.equal(zhCN.tab.current, "当前页面");
});
