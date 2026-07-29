import type { BrowserActionStep, PageElementSnapshot, PageSnapshot, PopupHousekeepingRequest } from "@auto-page-agent/shared";

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

export function findPopupHousekeepingRequest(
  completedStep: BrowserActionStep,
  remainingSteps: BrowserActionStep[],
  snapshot: PageSnapshot,
): PopupHousekeepingRequest | undefined {
  const completedPopupItem = completedStep.action === "click" && completedStep.targetFingerprint
    ? snapshot.elements.find((element) =>
    element.fingerprint === completedStep.targetFingerprint
    && (element.role === "option" || element.role === "menuitem")
    && (element.role === "menuitem" || element.selected === true)
    && Boolean(element.ownerId || element.layerId?.startsWith("popup:"))
    && !element.occluded)
    : undefined;
  const openComboboxes = snapshot.elements.filter((element) =>
    element.role === "combobox" && element.expanded === true && !element.occluded);
  const openPopupRoots = snapshot.elements.filter((element) =>
    (element.role === "listbox" || element.role === "menu") && !element.occluded);
  if (!openComboboxes.length && !openPopupRoots.length) return undefined;

  const nextTarget = remainingSteps[0]?.targetFingerprint
    ? snapshot.elements.find((element) =>
      element.fingerprint === remainingSteps[0]!.targetFingerprint && !element.occluded)
    : undefined;
  if (!nextTarget && !completedPopupItem) return undefined;

  const completedOwnerId = completedPopupItem?.ownerId;
  const completedLayerId = completedPopupItem?.layerId;
  const anchor = openComboboxes.find((element) =>
    completedOwnerId
    && [...parseIdRefs(element.controls), ...parseIdRefs(element.owns)].includes(completedOwnerId))
    ?? openPopupRoots.find((element) =>
      (completedOwnerId && element.domId === completedOwnerId)
      || (completedLayerId && element.layerId === completedLayerId))
    ?? openComboboxes.at(-1)
    ?? openPopupRoots.at(-1);
  if (!anchor) return undefined;
  const ownerIds = new Set([
    ...parseIdRefs(anchor.controls),
    ...parseIdRefs(anchor.owns),
    ...(anchor.domId ? [anchor.domId] : []),
  ]);
  const popupLayerIds = new Set(snapshot.elements
    .filter((element) =>
      (element.role === "listbox" || element.role === "menu")
      && Boolean(element.domId && ownerIds.has(element.domId)))
    .map((element) => element.layerId)
    .filter((value): value is string => Boolean(value)));
  if (anchor.layerId?.startsWith("popup:")) popupLayerIds.add(anchor.layerId);

  if (nextTarget?.role === "option"
    && nextTarget.selected !== true
    && (Boolean(nextTarget.ownerId && ownerIds.has(nextTarget.ownerId))
      || Boolean(nextTarget.layerId && popupLayerIds.has(nextTarget.layerId)))) {
    return undefined;
  }

  return {
    snapshotId: snapshot.snapshotId,
    targetRef: anchor.ref,
    targetFingerprint: anchor.fingerprint,
  };
}

function isValidQueuedTarget(step: BrowserActionStep, element: PageElementSnapshot): boolean {
  if (element.occluded || element.disabled) return false;
  if ((step.action === "fill" || step.action === "select")
    && (element.readonly || element.sensitive)) return false;
  return true;
}

function parseIdRefs(value: string | undefined): string[] {
  return value?.split(/\s+/u).filter(Boolean) ?? [];
}
