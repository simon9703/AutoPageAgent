import type { AgentLoopContext, ChatMessage, PageSnapshot, SkillSelection } from "@auto-page-agent/shared";

export function createAgentPrompt(
  task: string,
  snapshot: PageSnapshot,
  skills: string[],
  history: ChatMessage[] = [],
  loop?: AgentLoopContext,
  selectedSkills: SkillSelection[] = [],
): string {
  const loopState = loop ? {
    iteration: loop.iteration,
    maxSteps: loop.maxSteps,
    elapsedMs: Date.now() - loop.startedAt,
    lastAction: loop.lastAction,
    lastVerification: loop.lastVerification,
    reobserve: loop.reobserve,
  } : undefined;
  const promptSnapshot = {
    ...snapshot,
    elements: undefined,
    ...(snapshot.context?.screenshot ? { context: { ...snapshot.context, screenshot: { title: snapshot.context.screenshot.title, url: snapshot.context.screenshot.url } } } : {}),
  };
  return [
    "You are a current-page browser agent. Internally observe, decide, act, and verify without narrating those phase names.",
    "Return exactly one JSON object without Markdown.",
    "For a request that needs no browser action return: {\"kind\":\"answer\",\"content\":\"...\"}.",
    "For an explicit browser action return: {\"kind\":\"action_plan\",\"summary\":\"...\",\"snapshotId\":\"...\",\"requiresConfirmation\":true,\"confidence\":0.8,\"steps\":[{\"action\":\"click|fill|select|scroll|focus|submit\",\"targetRef\":\"element-ref\",\"value\":\"...\",\"reason\":\"...\"}]}.",
    "When the entire original browser task is satisfied return: {\"kind\":\"complete\",\"summary\":\"...\",\"evidence\":[\"exact text or URL copied from the current snapshot\"]}.",
    "When required user input or confirmation is missing return: {\"kind\":\"needs_user\",\"question\":\"...\"}.",
    "When no safe action or recovery is available return: {\"kind\":\"blocked\",\"reason\":\"...\",\"recoverable\":false}.",
    "Plan exactly one next action. The runtime observes and verifies the page again before asking for another action.",
    "If loopState.reobserve is present, the previous snapshot and refs are invalid. Replan only from the current Page snapshot and never retry an old ref.",
    "Use only data-ai-ref values present in simplifiedDom as targetRef. Prefer visible, unoccluded, enabled elements. Never output JavaScript, CSS selectors, XPath, payment, purchase, credential, destructive, or final irreversible actions.",
    "A successful action is not task completion. Once an action has been executed, never use answer to report completion; use complete with exact evidence copied from the current snapshot. Navigation alone is not completion.",
    selectedSkills.length ? `Selected Skill context:\n${selectedSkills.map((skill) => `${skill.name} (${skill.scope}): ${skill.reason}`).join("\n")}` : "",
    skills.length ? `Applicable skills:\n${skills.join("\n\n")}` : "",
    history.length ? `Recent conversation:\n${history.slice(-12).map((message) => `${message.role}: ${message.content}`).join("\n")}` : "",
    loopState ? `Loop state:\n${JSON.stringify(loopState)}` : "",
    `User task:\n${task}`,
    `Page snapshot:\n${JSON.stringify(promptSnapshot)}`,
  ].filter(Boolean).join("\n\n");
}
