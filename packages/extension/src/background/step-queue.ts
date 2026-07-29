import type { BrowserActionStep, PageElementSnapshot, PageSnapshot } from "@auto-page-agent/shared";

export function rebindQueuedStep(step: BrowserActionStep, snapshot: PageSnapshot): BrowserActionStep | undefined {
  if (step.action === "scroll" && !step.targetFingerprint) {
    return { ...step, targetRef: undefined };
  }
  if (!step.targetFingerprint) return undefined;
  const matches = snapshot.elements.filter((element) =>
    element.fingerprint === step.targetFingerprint && isValidQueuedTarget(step, element));
  if (matches.length !== 1) return undefined;
  return { ...step, targetRef: matches[0]!.ref };
}

export function createPopupDismissStepAfterOptionSelection(
  completedStep: BrowserActionStep,
  remainingSteps: BrowserActionStep[],
  snapshot: PageSnapshot,
): BrowserActionStep | undefined {
  if (completedStep.action !== "click" || !completedStep.targetFingerprint) return undefined;
  if (remainingSteps[0]?.action === "dismiss") return undefined;

  const selectedOption = snapshot.elements.find((element) =>
    element.fingerprint === completedStep.targetFingerprint
    && element.role === "option"
    && element.selected === true
    && Boolean(element.ownerId)
    && !element.occluded);
  if (!selectedOption?.ownerId) return undefined;

  const nextTarget = remainingSteps[0]?.targetFingerprint
    ? snapshot.elements.find((element) =>
      element.fingerprint === remainingSteps[0]!.targetFingerprint && !element.occluded)
    : undefined;
  if (nextTarget?.role === "option"
    && nextTarget.ownerId === selectedOption.ownerId
    && nextTarget.selected !== true) {
    return undefined;
  }

  const ownerIds = new Set([selectedOption.ownerId]);
  const anchor = snapshot.elements.find((element) =>
    element.role === "combobox"
    && element.expanded === true
    && [...parseIdRefs(element.controls), ...parseIdRefs(element.owns)]
      .some((id) => ownerIds.has(id))
    && !element.occluded)
    ?? snapshot.elements.find((element) =>
      (element.role === "listbox" || element.role === "menu")
      && element.domId === selectedOption.ownerId
      && !element.occluded)
    ?? selectedOption;

  return {
    action: "dismiss",
    targetRef: anchor.ref,
    targetFingerprint: anchor.fingerprint,
    reason: "Close the selected dropdown before continuing with the next field.",
  };
}

function isValidQueuedTarget(step: BrowserActionStep, element: PageElementSnapshot): boolean {
  if (element.occluded || element.disabled) return false;
  if ((step.action === "fill" || step.action === "select")
    && (element.readonly || element.sensitive)) return false;
  if (step.action === "dismiss"
    && !((element.role === "combobox" && element.expanded === true)
      || element.role === "listbox"
      || element.role === "menu"
      || (element.role === "option" && element.selected === true && Boolean(element.ownerId))
      || element.role === "dialog")) return false;
  return true;
}

function parseIdRefs(value: string | undefined): string[] {
  return value?.split(/\s+/u).filter(Boolean) ?? [];
}
