import type { SkillSummaryRequest, SkillSummaryResult } from "@auto-page-agent/shared";
import { cleanSingleLine } from "./utils.js";

export function summarizeSkill(input: SkillSummaryRequest): SkillSummaryResult {
  const userMessages = input.messages.filter((message) => message.role === "user");
  const goal = cleanSingleLine(userMessages.at(-1)?.content ?? input.pageTitle ?? "页面操作", 180);
  const pageTitle = cleanSingleLine(input.pageTitle || safeHostname(input.pageUrl) || "页面", 60);
  const actionNotes = input.operationNotes.map((note) => cleanSingleLine(note, 240)).filter(Boolean).slice(-20);
  const conversation = input.messages
    .slice(-12)
    .map((message) => `${message.role === "user" ? "用户" : "Agent"}：${cleanSingleLine(message.content, 300)}`)
    .filter((line) => line.length > 4);
  const instructions = [
    `目标：${goal}`,
    `适用页面：${input.pageUrl}`,
    "",
    "执行规则：",
    "- 先重新观察当前页面，再根据可见内容执行目标。",
    "- 使用最新页面快照中的元素，不复用过期引用或固定模型选择器。",
    "- 每一步操作后重新观察并验证结果；提交或发布前保留一次确认。",
    ...(actionNotes.length ? ["", "本次已验证的操作：", ...actionNotes.map((note) => `- ${note}`)] : []),
    ...(conversation.length ? ["", "对话摘要：", ...conversation.map((line) => `- ${line}`)] : []),
  ].join("\n").slice(0, 20_000);
  return {
    name: `${pageTitle} Skill`.slice(0, 80),
    description: `根据当前页面对话和已执行操作完成：${goal}`.slice(0, 240),
    instructions,
    startUrl: input.pageUrl,
    steps: input.actions.slice(-100),
  };
}

function safeHostname(value: string): string {
  try { return new URL(value).hostname; } catch { return ""; }
}
