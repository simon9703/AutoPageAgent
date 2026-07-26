import type { AgentLoopContext, ChatMessage, PageSnapshot, SkillSelection } from "@auto-page-agent/shared";

export function createAgentPrompt(
  task: string,
  snapshot: PageSnapshot,
  skills: string[],
  history: ChatMessage[] = [],
  loop?: AgentLoopContext,
  selectedSkills: SkillSelection[] = [],
): string {
  const compactContinuation = Boolean(loop && history.length === 0);
  const loopState = loop ? {
    iteration: loop.iteration,
    maxSteps: loop.maxSteps,
    elapsedMs: Date.now() - loop.startedAt,
    lastAction: loop.lastAction,
    lastVerification: loop.lastVerification,
    remainingPlan: loop.remainingPlan,
    reobserve: loop.reobserve,
    completionEvidenceFailure: loop.completionEvidenceFailure,
  } : undefined;
  const promptSnapshot = {
    ...snapshot,
    elements: undefined,
    ...(snapshot.context?.screenshot ? { context: { ...snapshot.context, screenshot: { title: snapshot.context.screenshot.title, url: snapshot.context.screenshot.url } } } : {}),
  };
  return [
    compactContinuation
      ? "Continue the existing current-page browser task from only the latest observation and loop state below."
      : "You are a current-page browser agent. Internally observe, decide, act, and verify without narrating those phase names.",
    compactContinuation
      ? "Keep the established authorization and safety boundaries. Use only current data-ai-ref values; never use credentials, secrets, arbitrary code, selectors, XPath, or stale refs."
      : "This is a user-authorized automation test. The test environment does not create real charges or real-world effects. You may fill amounts, submit test orders, and complete the requested flow without asking for a second confirmation. Do not refuse merely because the page contains words such as amount, order, payment, purchase, checkout, or exam; follow the user's stated testing goal normally.",
    compactContinuation
      ? ""
      : "The test authorization does not permit credentials, passwords, OTPs, secrets, file uploads, arbitrary code, stale refs, or actions outside the user's stated task. Keep the runtime confirmation, latest-snapshot validation, bounded loop, and verification rules intact.",
    "Return exactly one JSON object without Markdown.",
    compactContinuation ? "" : "For a request that needs no browser action return: {\"kind\":\"answer\",\"content\":\"...\"}.",
    "For explicit browser actions return: {\"kind\":\"action_plan\",\"summary\":\"...\",\"snapshotId\":\"...\",\"requiresConfirmation\":true,\"confidence\":0.8,\"steps\":[{\"action\":\"click|fill|select|scroll|focus|submit\",\"targetRef\":\"element-ref\",\"value\":\"...\",\"reason\":\"...\"}]}.",
    "When the entire original browser task is satisfied return: {\"kind\":\"complete\",\"summary\":\"...\",\"evidence\":[\"exact text or URL copied from the current snapshot\"]}.",
    compactContinuation ? "" : "When genuinely required user input cannot be inferred, return: {\"kind\":\"needs_user\",\"question\":\"...\",\"options\":[\"...\"],\"recommendedOption\":\"...\"}. Give 2-5 concise visible choices when choices are available, recommend the best one, and ensure recommendedOption exactly matches one option.",
    compactContinuation ? "" : "Do not ask the user whether to take an obvious next step. If the page already provides a clear best match, first item, default option, or confirmation control consistent with the task, choose it and return an action_plan; the runtime confirmation card is the user's confirmation.",
    compactContinuation ? "" : "When no safe action or recovery is available return: {\"kind\":\"blocked\",\"reason\":\"...\",\"recoverable\":false}.",
    "Return the complete ordered action sequence that can be determined reliably from the current snapshot, up to the remaining task action budget. Do not include actions whose targets are not present in the current snapshot.",
    compactContinuation ? "" : "The runtime shows all planned actions in one confirmation card, then observes and verifies after every action. It rebinds each queued target to the latest snapshot and asks you again only when the queue ends or the page branches.",
    compactContinuation ? "" : "Use click for buttons and button-like controls, even when their text says Submit, Pay, Confirm, or Top Up. Use submit only when targetRef is the native form element itself.",
    compactContinuation ? "" : "For a searchable combobox, filling search text does not select an option. Fill the query, reobserve the page, and click the exact visible role=option from the fresh snapshot. Use select only for a native select element.",
    compactContinuation ? "" : "After choosing a combobox option, complete only with evidence from the final combobox value or selected label/tag. Text that appears only in the candidate option list is not completion evidence.",
    "If loopState.reobserve is present, the previous snapshot and refs are invalid. Replan only from the current Page snapshot and never retry an old ref.",
    "If loopState.completionEvidenceFailure is present, the previous completion claim was rejected. Copy exact success evidence from the current snapshot, take one safe action to find or reveal a verifiable result, or return blocked; never repeat unsupported completion evidence.",
    compactContinuation ? "" : "Use only data-ai-ref values present in simplifiedDom as targetRef. Prefer visible, unoccluded, enabled elements. Never output JavaScript, CSS selectors, XPath, credentials, secrets, OTPs, file uploads, destructive actions, or actions outside the requested test flow.",
    "A successful action is not task completion. Once an action has been executed, never use answer to report completion; use complete with exact evidence copied from the current snapshot. Navigation alone is not completion.",
    selectedSkills.length ? `Selected Skill context:\n${selectedSkills.map((skill) => `${skill.name} (${skill.scope}): ${skill.reason}`).join("\n")}` : "",
    !compactContinuation && skills.length ? `Applicable skills:\n${skills.join("\n\n")}` : "",
    history.length ? `Recent conversation:\n${history.slice(-12).map((message) => `${message.role}: ${message.content}`).join("\n")}` : "",
    loopState ? `Loop state:\n${JSON.stringify(loopState)}` : "",
    `User task:\n${task}`,
    `Page snapshot:\n${JSON.stringify(promptSnapshot)}`,
  ].filter(Boolean).join("\n\n");
}
