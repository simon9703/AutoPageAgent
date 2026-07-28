import type { AgentDecision, BrowserActionPlan, PageSnapshot } from "@auto-page-agent/shared";

const ACTIONS = new Set(["click", "fill", "select", "scroll", "focus", "submit", "dismiss"]);
const MAX_PLAN_STEPS = 8;

export function normalizeDecision(value: unknown, snapshot: PageSnapshot, task = ""): AgentDecision {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (raw.kind === "answer") {
    return { kind: "answer", content: String(raw.content || "The agent returned no answer.").slice(0, 8_000) };
  }
  if (raw.kind === "complete") {
    const evidence = Array.isArray(raw.evidence)
      ? raw.evidence.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.slice(0, 500)).slice(0, 8)
      : [];
    if (!evidence.length) {
      return {
        kind: "blocked",
        reason: "The agent claimed completion without current page evidence.",
        recoverable: true,
        code: "completion_evidence_missing",
        unmatchedEvidence: [],
      };
    }
    const matchedEvidence = evidence.filter((item) => completionEvidenceMatchesSnapshot(item, snapshot));
    if (!matchedEvidence.length) {
      return {
        kind: "blocked",
        reason: "The agent claimed completion with evidence that is not present in the current page snapshot.",
        recoverable: true,
        code: "completion_evidence_missing",
        unmatchedEvidence: evidence,
      };
    }
    return {
      kind: "complete",
      summary: String(raw.summary || "Task completed.").slice(0, 2_000),
      evidence: matchedEvidence,
    };
  }
  if (raw.kind === "needs_user") {
    const options = Array.isArray(raw.options)
      ? [...new Set(raw.options
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => item.trim().slice(0, 240)))]
        .slice(0, 5)
      : [];
    const requestedRecommendation = typeof raw.recommendedOption === "string"
      ? raw.recommendedOption.trim()
      : "";
    const recommendedOption = requestedRecommendation
      ? options.find((option) => option === requestedRecommendation)
      : undefined;
    return {
      kind: "needs_user",
      question: String(raw.question || "More information is required.").slice(0, 2_000),
      ...(options.length ? { options } : {}),
      ...(recommendedOption ? { recommendedOption } : {}),
    };
  }
  if (raw.kind === "blocked") {
    return {
      kind: "blocked",
      reason: String(raw.reason || "The agent could not continue safely.").slice(0, 2_000),
      recoverable: raw.recoverable === true,
    };
  }
  if (raw.kind !== "action_plan") {
    return { kind: "blocked", reason: "The agent returned an unsupported decision.", recoverable: true };
  }
  const validElements = new Map(snapshot.elements.filter((element) => !element.occluded).map((element) => [element.ref, element]));
  const validRefs = new Set(validElements.keys());
  const writableRefs = new Set(snapshot.elements.filter((element) => !element.disabled && !element.readonly && !element.sensitive && !element.occluded).map((element) => element.ref));
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  if (rawSteps.length > MAX_PLAN_STEPS) {
    return {
      kind: "blocked",
      reason: `The action plan exceeds the ${MAX_PLAN_STEPS}-action task budget.`,
      recoverable: true,
    };
  }
  const steps = rawSteps.flatMap((value) => {
    const step = value && typeof value === "object" ? value as Record<string, unknown> : {};
    if (!ACTIONS.has(String(step.action))) return [];
    if (step.action !== "scroll" && !validRefs.has(String(step.targetRef))) return [];
    const target = validElements.get(String(step.targetRef));
    if ((step.action === "fill" || step.action === "select") && !writableRefs.has(String(step.targetRef))) return [];
    if (step.action === "fill" && target?.role === "combobox") return [];
    if (step.action === "select" && target?.tagName !== "select") return [];
    const allowDialogDismiss = step.action === "dismiss"
      && target?.role === "dialog"
      && explicitlyRequestsDialogDismissal(task);
    if (step.action === "dismiss" && (!target || !isSafeDismissTarget(snapshot, target, allowDialogDismiss))) return [];
    const targetRef = String(step.targetRef);
    const action = String(step.action) === "submit" && validElements.get(targetRef)?.tagName !== "form"
      ? "click"
      : String(step.action) as BrowserActionPlan["steps"][number]["action"];
    return [{
      action,
      ...(validRefs.has(targetRef) ? {
        targetRef,
        targetFingerprint: validElements.get(targetRef)!.fingerprint,
      } : {}),
      ...(allowDialogDismiss ? { allowDialogDismiss: true } : {}),
      ...(typeof step.value === "string" ? { value: step.value.slice(0, 4_000) } : {}),
      ...(typeof step.amountPx === "number" ? { amountPx: Math.min(Math.max(step.amountPx, 0), 2_000) } : {}),
      reason: String(step.reason || "User-requested action.").slice(0, 240),
    }];
  });
  if (!steps.length) {
    return { kind: "blocked", reason: "No safe action could be matched to the current page.", recoverable: true };
  }
  if (steps.length !== rawSteps.length) {
    return {
      kind: "blocked",
      reason: "The action plan contained an invalid or stale step and was rejected without partial execution.",
      recoverable: true,
    };
  }
  return {
    kind: "action_plan",
    summary: String(raw.summary || "Proposed browser actions."),
    snapshotId: snapshot.snapshotId,
    requiresConfirmation: true,
    confidence: typeof raw.confidence === "number" ? Math.min(Math.max(raw.confidence, 0), 1) : 0,
    steps,
  };
}

function isSafeDismissTarget(
  snapshot: PageSnapshot,
  target: PageSnapshot["elements"][number],
  allowFilledDialog: boolean,
): boolean {
  if (target.occluded || target.disabled) return false;
  if (target.role === "combobox") return target.expanded === true;
  if (target.role === "listbox" || target.role === "menu") return true;
  if (target.role !== "dialog") return false;

  const openInnerLayer = snapshot.elements.some((element) =>
    !element.occluded
    && ((element.role === "combobox" && element.expanded === true)
      || element.role === "listbox"
      || element.role === "menu"));
  if (openInnerLayer) return false;

  const dialogs = snapshot.elements.filter((element) => element.role === "dialog" && !element.occluded);
  if (dialogs.at(-1)?.fingerprint !== target.fingerprint) return false;
  return allowFilledDialog || !snapshot.elements.some((element) =>
    element.fingerprint !== target.fingerprint
    && containsRect(target.viewportRect, element.viewportRect)
    && hasFilledState(element));
}

function explicitlyRequestsDialogDismissal(task: string): boolean {
  return /(?:cancel|close|dismiss|exit).{0,24}(?:dialog|modal|window|form)|(?:dialog|modal|window|form).{0,24}(?:cancel|close|dismiss|exit)/iu.test(task)
    || /(?:取消|关闭|退出)(?:当前|这个|该)?(?:弹窗|对话框|窗口|表单)|(?:弹窗|对话框|窗口|表单).{0,8}(?:取消|关闭|退出)/u.test(task);
}

function containsRect(
  outer: PageSnapshot["elements"][number]["viewportRect"],
  inner: PageSnapshot["elements"][number]["viewportRect"],
): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function hasFilledState(element: PageSnapshot["elements"][number]): boolean {
  return Boolean(
    element.checked
    || element.selected
    || element.value?.trim()
    || element.displayValue?.trim()
    || element.selectedValues?.some((value) => value.trim()),
  );
}

export function completionEvidenceMatchesSnapshot(evidence: string, snapshot: PageSnapshot): boolean {
  const normalizedEvidence = normalizeEvidence(evidence);
  if (normalizedEvidence.length < 2) return false;
  const finalStateEvidence = [
    snapshot.url,
    snapshot.title,
    snapshot.selectedText,
    ...snapshot.headings.map((heading) => heading.text),
    ...snapshot.elements.flatMap((element) => {
      if ((element.role === "option" && element.selected !== true)
        || element.role === "listbox"
        || element.role === "menu") return [];
      return [
        element.label,
        element.text,
        element.value ?? "",
        element.displayValue ?? "",
        ...(element.selectedValues ?? []),
        element.href ?? "",
        element.placeholder ?? "",
      ];
    }),
  ].map(normalizeEvidence);
  if (finalStateEvidence.some((candidate) => candidate.includes(normalizedEvidence))) return true;

  const unselectedPopupEvidence = snapshot.elements
    .filter((element) => (element.role === "option" && element.selected !== true)
      || element.role === "listbox"
      || element.role === "menu")
    .flatMap((element) => [element.label, element.text, element.value ?? ""])
    .map(normalizeEvidence);
  if (unselectedPopupEvidence.some((candidate) => candidate.includes(normalizedEvidence))) return false;

  return [snapshot.mainText, snapshot.simplifiedDom]
    .map(normalizeEvidence)
    .some((candidate) => candidate.includes(normalizedEvidence));
}

function normalizeEvidence(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(text)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!candidate) throw new Error("Codex did not return JSON.");
  return JSON.parse(candidate);
}

export function mockDecision(task: string, snapshot: PageSnapshot): AgentDecision {
  const performanceSummary = snapshot.performance
    ? `\nRequests: ${snapshot.performance.summary.requestCount}\nSlow requests: ${snapshot.performance.summary.slowRequestCount}`
    : "";
  return { kind: "answer", content: `Mock analysis for ${snapshot.title}\n\nTask: ${task}\nInteractive elements: ${snapshot.elements.length}${performanceSummary}` };
}
