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

function isValidQueuedTarget(step: BrowserActionStep, element: PageElementSnapshot): boolean {
  if (element.occluded || element.disabled) return false;
  if ((step.action === "fill" || step.action === "select")
    && (element.readonly || element.sensitive)) return false;
  return true;
}
