import type { BrowserActionStep, PageElementSnapshot, PageSnapshot, PageSnapshotDiff } from "@auto-page-agent/shared";

export function hasObservableActionEffect(
  step: BrowserActionStep,
  before: PageSnapshot,
  after: PageSnapshot,
  diff: PageSnapshotDiff,
  targetFingerprint?: string,
): boolean {
  if (step.action === "scroll") {
    return before.pageInfo.scrollX !== after.pageInfo.scrollX
      || before.pageInfo.scrollY !== after.pageInfo.scrollY;
  }
  if (diff.urlChanged) return true;
  if (!targetFingerprint) return false;
  if (diff.changedFingerprints.includes(targetFingerprint) || diff.removedFingerprints.includes(targetFingerprint)) {
    return true;
  }
  const resultRoles = new Set(["alert", "dialog", "status"]);
  return after.elements.some((element) =>
    diff.addedFingerprints.includes(element.fingerprint) && resultRoles.has(element.role));
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
    return targetAfter?.expanded === false;
  }
  if (targetBefore.role === "listbox" || targetBefore.role === "menu" || targetBefore.role === "dialog") {
    return !after.elements.some((element) => isSameSemanticControl(targetBefore, element));
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

function normalizeValue(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}
