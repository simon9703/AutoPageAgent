import type { BrowserActionStep, PageElementSnapshot, PageSnapshot, PageSnapshotDiff } from "@auto-page-agent/shared";

export function hasObservableActionEffect(
  step: BrowserActionStep,
  before: PageSnapshot,
  after: PageSnapshot,
  diff: PageSnapshotDiff,
): boolean {
  if (step.action === "scroll") {
    return before.pageInfo.scrollX !== after.pageInfo.scrollX
      || before.pageInfo.scrollY !== after.pageInfo.scrollY;
  }
  return diff.summary.length > 0;
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
  const targetName = normalizeValue(targetBefore.label || targetBefore.text || targetBefore.value || "");
  const targetAfter = after.elements.find((element) => element.fingerprint === targetFingerprint);
  if (targetAfter?.selected === true) return true;

  const selectedMatch = after.elements.some((element) =>
    element.selected === true && snapshotValueMatches(element, targetName));
  if (selectedMatch) return true;

  const comboboxValueMatch = after.elements.some((element) =>
    element.role === "combobox" && snapshotValueMatches(element, targetName));
  if (comboboxValueMatch) return true;

  const beforeComboboxes = new Map(before.elements
    .filter((element) => element.role === "combobox")
    .map((element) => [element.fingerprint, element]));
  const comboboxCollapsed = after.elements.some((element) =>
    element.role === "combobox"
    && element.expanded === false
    && beforeComboboxes.get(element.fingerprint)?.expanded === true);
  if (comboboxCollapsed) return true;

  const optionDisappeared = !targetAfter;
  return optionDisappeared && after.elements.some((element) =>
    !isOptionSnapshot(element) && snapshotValueMatches(element, targetName));
}

function snapshotValueMatches(element: PageElementSnapshot, expected: string): boolean {
  if (!expected) return false;
  return [element.value, element.label, element.text]
    .some((value) => normalizeValue(value ?? "") === expected);
}

function normalizeValue(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}
