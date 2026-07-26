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
  '[role="option"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  "[aria-controls]",
  "[aria-expanded]",
  "[aria-selected]",
  "[tabindex]",
].join(",");

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
