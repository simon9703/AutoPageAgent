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
    visualRecovery: loop.visualRecovery,
    completionEvidenceFailure: loop.completionEvidenceFailure,
  } : undefined;
  const promptSnapshot = {
    ...snapshot,
    elements: undefined,
    ...(snapshot.context?.screenshot ? {
      context: {
        ...snapshot.context,
        screenshot: {
          title: snapshot.context.screenshot.title,
          url: snapshot.context.screenshot.url,
          visualMarks: snapshot.context.screenshot.visualMarks,
        },
      },
    } : {}),
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
    "For explicit browser actions return an action_plan. Stable same-page example: {\"kind\":\"action_plan\",\"summary\":\"Fill the amount and continue\",\"snapshotId\":\"current-snapshot-id\",\"requiresConfirmation\":true,\"confidence\":0.9,\"steps\":[{\"action\":\"fill\",\"targetRef\":\"amount-ref\",\"value\":\"100\",\"reason\":\"Enter the requested amount\"},{\"action\":\"click\",\"targetRef\":\"duration-ref\",\"reason\":\"Choose the requested duration\"},{\"action\":\"click\",\"targetRef\":\"next-ref\",\"reason\":\"Continue to the next step\"}]}.",
    "When the latest page shows that the entire original browser task is satisfied, return: {\"kind\":\"complete\",\"summary\":\"...\",\"evidence\":[\"one to three exact visible texts or the exact URL copied from the current snapshot\"]}. Keep explanations in summary, never in evidence.",
    compactContinuation ? "" : "When genuinely required user input cannot be inferred, return: {\"kind\":\"needs_user\",\"question\":\"...\",\"options\":[\"...\"],\"recommendedOption\":\"...\"}. Give 2-5 concise visible choices when choices are available, recommend the best one, and ensure recommendedOption exactly matches one option.",
    compactContinuation ? "" : "Do not ask the user whether to take an obvious next step. If the page already provides a clear best match, first item, default option, or confirmation control consistent with the task, choose it and return an action_plan; the runtime confirmation card is the user's confirmation.",
    compactContinuation ? "" : "When no safe action or recovery is available return: {\"kind\":\"blocked\",\"reason\":\"...\",\"recoverable\":false}.",
    "MUST return every stable, deterministic same-page action whose target already exists in the current snapshot, in one ordered plan up to the remaining task action budget. Returning only the first action is incorrect when later same-page targets are already visible and their order is known.",
    "An action expected to navigate, replace page context, or open a dynamic popup may be the final step of the current plan, but MUST NOT have later queued steps. Never pre-plan a target that appears only after such a branch boundary.",
    compactContinuation ? "" : "The runtime shows all planned actions in one confirmation card, then observes and verifies after every action. It rebinds each queued target to the latest snapshot and asks you again only when the queue ends or the page branches.",
    compactContinuation ? "" : "Use click for buttons and button-like controls, even when their text says Submit, Pay, Confirm, or Top Up. Use submit only when targetRef is the native form element itself.",
    compactContinuation ? "" : "Readonly and custom role=combobox controls cannot use fill or select. Click the combobox to expand it, wait for a fresh snapshot, then click the exact visible role=option from that new snapshot. Use select only for a native select element.",
    "Opening a combobox is a branch point. Reobserve before choosing an option, and never reuse a ref from before the expansion, selection, or dismissal.",
    "Never click an option whose aria-selected state is already true in order to close a popup. For a multi-select, choose all required unselected options, then use dismiss on the expanded combobox, visible listbox/menu, or a currently selected option belonging to that popup; the selected option is only an anchor and is not clicked again.",
    "Dismiss is restricted to the current snapshot's expanded combobox, visible listbox/menu, selected popup option, or topmost dialog. Prefer dismissing the innermost dropdown. Use an explicit close button with ordinary click, and never invent a backdrop, blank-area coordinate, selector, or ref.",
    "A dismiss succeeds only when the fresh snapshot proves the target collapsed or disappeared. The content script sends Escape, checks the live popup state, then computes and clicks a verified non-interactive exterior point when needed. Never plan coordinates, click the combobox itself to close it, or repeat a separate closing strategy after dismiss.",
    "Do not dismiss an entire dialog that contains filled values unless the user explicitly asked to cancel or close that dialog; close only the inner dropdown instead.",
    compactContinuation ? "" : "After choosing a combobox option, complete only with evidence from the final combobox value or selected label/tag. Text that appears only in the candidate option list is not completion evidence.",
    "When context.screenshot.visualMarks is present, numbered red outlines in the attached image match the global [N] prefixes in simplifiedDom and visualMarks maps those numbers to current refs. Use the matching current data-ai-ref as targetRef; never return a number or coordinate as an action target.",
    "If loopState.reobserve is present, the previous snapshot and refs are invalid. Replan only from the current Page snapshot and never retry an old ref.",
    "If loopState.visualRecovery is present, inspect the attached viewport image together with the current DOM snapshot. The image may explain a visual state, but actions must still target current data-ai-ref values and completion still requires exact DOM or URL evidence. If the needed control is visible only in the image without a mapped current ref, return blocked instead of inventing coordinates.",
    "If loopState.completionEvidenceFailure is present, the previous completion claim was rejected. Copy exact success evidence from the current snapshot, take one safe action to find or reveal a verifiable result, or return blocked; never repeat unsupported completion evidence.",
    compactContinuation ? "" : "Use only data-ai-ref values present in simplifiedDom as targetRef. Prefer visible, unoccluded, enabled elements. Never output JavaScript, CSS selectors, XPath, credentials, secrets, OTPs, file uploads, destructive actions, or actions outside the requested test flow.",
    "A successful action is not task completion. After navigation, analyze the latest destination page and return complete when it visibly shows the requested result. Once an action has been executed, never use answer to report completion; use complete with exact evidence copied from the latest snapshot.",
    selectedSkills.length ? `Selected Skill context:\n${selectedSkills.map((skill) => `${skill.name} (${skill.scope}): ${skill.reason}`).join("\n")}` : "",
    !compactContinuation && skills.length ? `Applicable skills:\n${skills.join("\n\n")}` : "",
    history.length ? `Recent conversation:\n${history.slice(-12).map((message) => `${message.role}: ${message.content}`).join("\n")}` : "",
    loopState ? `Loop state:\n${JSON.stringify(loopState)}` : "",
    `User task:\n${task}`,
    `Page snapshot:\n${JSON.stringify(promptSnapshot)}`,
  ].filter(Boolean).join("\n\n");
}
