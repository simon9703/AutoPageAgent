export const SNAPSHOT_CANDIDATE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="dialog"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="option"]',
  '[role="status"]',
  '[role="alert"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  "[aria-controls]",
  "[aria-expanded]",
  "[aria-selected]",
  "[tabindex]",
].join(",");

export interface SnapshotCandidatePriorityState {
  expandedControl: boolean;
  relatedToExpandedControl: boolean;
  visiblePopup: boolean;
  inViewport: boolean;
  changedOrAdded: boolean;
  nearViewport: boolean;
}

export function getSnapshotCandidatePriority(state: SnapshotCandidatePriorityState): number {
  if (state.expandedControl || state.relatedToExpandedControl) return 0;
  if (state.visiblePopup) return 1;
  if (state.inViewport) return 2;
  if (state.changedOrAdded) return 3;
  if (state.nearViewport) return 4;
  return 5;
}

export function parseAriaIdRefs(value: string | null | undefined): string[] {
  return value?.split(/\s+/u).map((id) => id.trim()).filter(Boolean) ?? [];
}

export interface SnapshotCandidateState {
  visible: boolean;
  nearViewport: boolean;
  hiddenInput: boolean;
  topLayer: boolean;
  disabled: boolean;
  readonly: boolean;
}

export function shouldIncludeSnapshotCandidate(state: SnapshotCandidateState): boolean {
  return state.visible
    && state.nearViewport
    && !state.hiddenInput
    && state.topLayer
    && !state.disabled
    && !state.readonly;
}

export function resolveSnapshotRole(explicitRole: string | null, inferredRole: string, hasAriaSelected: boolean): string {
  return explicitRole || inferredRole || (hasAriaSelected ? "option" : "");
}
