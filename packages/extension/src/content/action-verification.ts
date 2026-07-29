import type { BrowserActionStep, PageElementSnapshot, PageSnapshot, PageSnapshotDiff } from "@auto-page-agent/shared";

export function hasObservableActionEffect(
  step: BrowserActionStep,
  before: PageSnapshot,
  after: PageSnapshot,
  diff: PageSnapshotDiff,
  targetFingerprint?: string,
): boolean {
  if (step.action === "scroll") {
    if (targetFingerprint) {
      const beforeTarget = before.elements.find((element) => element.fingerprint === targetFingerprint);
      const afterTarget = after.elements.find((element) => element.fingerprint === targetFingerprint);
      return Boolean(beforeTarget?.scrollPosition && afterTarget?.scrollPosition
        && (beforeTarget.scrollPosition.x !== afterTarget.scrollPosition.x
          || beforeTarget.scrollPosition.y !== afterTarget.scrollPosition.y));
    }
    return before.pageInfo.scrollX !== after.pageInfo.scrollX
      || before.pageInfo.scrollY !== after.pageInfo.scrollY;
  }
  if (diff.urlChanged) return true;
  if (!targetFingerprint) return false;
  if (diff.changedFingerprints.includes(targetFingerprint) || diff.removedFingerprints.includes(targetFingerprint)) {
    return true;
  }
  const targetBefore = before.elements.find((element) => element.fingerprint === targetFingerprint);
  if (step.action === "click" && isSelectionLikeControl(targetBefore)) {
    const actionableRoles = new Set(["button", "checkbox", "combobox", "link", "radio", "switch", "textbox"]);
    const newlyAvailableControl = after.elements.some((element) =>
      diff.addedFingerprints.includes(element.fingerprint)
      && !element.disabled
      && actionableRoles.has(element.role)
      && hasMeaningfulSnapshotContent(element));
    if (newlyAvailableControl) return true;
  }
  const resultRoles = new Set(["alert", "dialog", "status"]);
  return after.elements.some((element) =>
    diff.addedFingerprints.includes(element.fingerprint)
    && resultRoles.has(element.role)
    && hasMeaningfulSnapshotContent(element));
}

export function hasVerifiedPaginationChange(
  before: PageSnapshot,
  after: PageSnapshot,
  targetFingerprint: string,
): boolean {
  const target = before.elements.find((element) => element.fingerprint === targetFingerprint);
  if (!target?.relation || target.disabled) return false;
  if (before.url !== after.url) return true;
  const currentBefore = before.elements
    .filter((element) => element.current)
    .map((element) => `${element.fingerprint}:${normalizeValue(element.label || element.text)}`)
    .sort();
  const currentAfter = after.elements
    .filter((element) => element.current)
    .map((element) => `${element.fingerprint}:${normalizeValue(element.label || element.text)}`)
    .sort();
  if (JSON.stringify(currentBefore) !== JSON.stringify(currentAfter)) return true;
  return Boolean(
    before.collectionSignature
    && after.collectionSignature
    && before.collectionSignature !== after.collectionSignature,
  );
}

function isSelectionLikeControl(element: PageElementSnapshot | undefined): boolean {
  return Boolean(element && (
    ["checkbox", "option", "radio", "switch"].includes(element.role)
    || typeof element.checked === "boolean"
    || typeof element.selected === "boolean"
  ));
}

export type PageTransitionState = "none" | "pending" | "completed";

export function getPageTransitionState(
  before: PageSnapshot,
  after: PageSnapshot,
  diff: PageSnapshotDiff,
): PageTransitionState {
  const titleChanged = before.title !== after.title && Boolean(after.title.trim());
  if (titleChanged) return "completed";
  if (normalizeValue(before.mainText) !== normalizeValue(after.mainText) && Boolean(after.mainText.trim())) {
    return "completed";
  }
  if (
    JSON.stringify(before.headings.map(({ level, text }) => [level, normalizeValue(text)]))
    !== JSON.stringify(after.headings.map(({ level, text }) => [level, normalizeValue(text)]))
    && after.headings.some(({ text }) => Boolean(text.trim()))
  ) {
    return "completed";
  }
  const resultRoles = new Set(["alert", "dialog", "status"]);
  if (after.elements.some((element) =>
    diff.addedFingerprints.includes(element.fingerprint)
    && resultRoles.has(element.role)
    && hasMeaningfulSnapshotContent(element))) {
    return "completed";
  }
  if (diff.urlChanged) return "pending";
  if (after.elements.some((element) =>
    diff.addedFingerprints.includes(element.fingerprint)
    && (element.role === "alert" || element.role === "status")
    && !hasMeaningfulSnapshotContent(element)
    && isOffscreenOrHiddenRegion(element))) {
    return "pending";
  }
  return "none";
}

export function isOptionSnapshot(element: PageElementSnapshot | undefined): element is PageElementSnapshot {
  return Boolean(element && (element.role === "option" || typeof element.selected === "boolean"));
}

export function hasVerifiedOptionSelection(
  before: PageSnapshot,
  after: PageSnapshot,
  targetFingerprint: string,
): boolean {
  const targetBefore = before.elements.find((element) => element.fingerprint === targetFingerprint);
  if (!isOptionSnapshot(targetBefore)) return false;
  if (targetBefore.selected === true) return false;
  const targetName = normalizeValue(targetBefore.label || targetBefore.text || targetBefore.value || "");
  const targetAfter = after.elements.find((element) => element.fingerprint === targetFingerprint);
  if (targetAfter?.selected === true) return true;

  const associatedBefore = findAssociatedComboboxes(before, targetBefore);
  if (!associatedBefore.length) return false;
  const associatedAfter = after.elements.filter((element) =>
    element.role === "combobox"
    && associatedBefore.some((previous) => isSameSemanticControl(previous, element)));

  const selectedMatch = after.elements.some((element) =>
    element.selected === true
    && belongsToSamePopup(element, targetBefore)
    && snapshotValueMatches(element, targetName));
  if (selectedMatch) return true;

  const comboboxValueMatch = associatedAfter.some((element) =>
    snapshotValueMatches(element, targetName)
    && !associatedBefore.some((previous) =>
      isSameSemanticControl(previous, element) && snapshotValueMatches(previous, targetName)));
  if (comboboxValueMatch) return true;

  return Boolean(targetBefore.domId && associatedAfter.some((element) =>
    element.activeDescendant === targetBefore.domId
    && !associatedBefore.some((previous) =>
      isSameSemanticControl(previous, element) && previous.activeDescendant === targetBefore.domId)));
}

export function hasVerifiedDismissal(
  before: PageSnapshot,
  after: PageSnapshot,
  targetFingerprint: string,
): boolean {
  const targetBefore = before.elements.find((element) => element.fingerprint === targetFingerprint);
  if (!targetBefore) return false;

  const outerDialogsPreserved = targetBefore.role === "dialog"
    || before.elements
      .filter((element) => element.role === "dialog")
      .every((dialog) => after.elements.some((element) =>
        element.role === "dialog" && isSameSemanticControl(dialog, element)));
  if (!outerDialogsPreserved) return false;

  if (targetBefore.role === "combobox") {
    if (targetBefore.expanded !== true) return false;
    const targetAfter = after.elements.find((element) => isSameSemanticControl(targetBefore, element));
    if (targetAfter?.expanded === false) return true;
    const controlledPopupIds = new Set([
      ...parseIdRefs(targetBefore.controls),
      ...parseIdRefs(targetBefore.owns),
    ]);
    if (!controlledPopupIds.size) return false;
    const controlledPopupWasVisible = before.elements.some((element) =>
      (element.role === "listbox" || element.role === "menu")
      && Boolean(element.domId && controlledPopupIds.has(element.domId)));
    return controlledPopupWasVisible && !after.elements.some((element) =>
      (element.role === "listbox" || element.role === "menu")
      && Boolean(element.domId && controlledPopupIds.has(element.domId)));
  }
  if (targetBefore.role === "listbox" || targetBefore.role === "menu" || targetBefore.role === "dialog") {
    return !after.elements.some((element) => isSameSemanticControl(targetBefore, element));
  }
  if (targetBefore.role === "option" && targetBefore.selected === true && targetBefore.ownerId) {
    const popupWasVisible = before.elements.some((element) =>
      (element.role === "listbox" || element.role === "menu")
      && element.domId === targetBefore.ownerId);
    const popupStillVisible = after.elements.some((element) =>
      (element.role === "listbox" || element.role === "menu")
      && element.domId === targetBefore.ownerId);
    const ownerCollapsed = after.elements.some((element) =>
      element.role === "combobox"
      && [...parseIdRefs(element.controls), ...parseIdRefs(element.owns)].includes(targetBefore.ownerId!)
      && element.expanded === false);
    return ownerCollapsed || (popupWasVisible && !popupStillVisible);
  }
  return false;
}

function isSameSemanticControl(before: PageElementSnapshot, after: PageElementSnapshot): boolean {
  if (before.fingerprint === after.fingerprint) return true;
  if (before.domId && before.domId === after.domId) return true;
  return Boolean(before.controls && before.controls === after.controls
    && before.label && before.label === after.label);
}

function findAssociatedComboboxes(snapshot: PageSnapshot, target: PageElementSnapshot): PageElementSnapshot[] {
  return snapshot.elements.filter((element) => {
    if (element.role !== "combobox") return false;
    const controlledIds = new Set([...parseIdRefs(element.controls), ...parseIdRefs(element.owns)]);
    return Boolean(
      (target.ownerId && controlledIds.has(target.ownerId))
      || (target.domId && (controlledIds.has(target.domId) || element.activeDescendant === target.domId)),
    );
  });
}

function belongsToSamePopup(candidate: PageElementSnapshot, target: PageElementSnapshot): boolean {
  return Boolean(target.ownerId && candidate.ownerId === target.ownerId);
}

function parseIdRefs(value: string | undefined): string[] {
  return value?.split(/\s+/u).filter(Boolean) ?? [];
}

function snapshotValueMatches(element: PageElementSnapshot, expected: string): boolean {
  if (!expected) return false;
  return [element.value, element.displayValue, ...(element.selectedValues ?? []), element.label, element.text]
    .some((value) => normalizeValue(value ?? "") === expected);
}

function hasMeaningfulSnapshotContent(element: PageElementSnapshot): boolean {
  return [element.label, element.text, element.value, element.displayValue, ...(element.selectedValues ?? [])]
    .some((value) => Boolean(value?.trim()));
}

function isOffscreenOrHiddenRegion(element: PageElementSnapshot): boolean {
  const rect = element.viewportRect;
  return element.inViewport === false
    || element.occluded
    || !rect
    || rect.width <= 1
    || rect.height <= 1;
}

function normalizeValue(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}
