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
  '[role="progressbar"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  "[aria-controls]",
  "[aria-expanded]",
  "[aria-selected]",
  "[aria-current]",
  "[rel~='next']",
  "[rel~='prev']",
  '[aria-busy="true"]',
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
    && state.topLayer;
}

export function resolveSnapshotRole(explicitRole: string | null, inferredRole: string, hasAriaSelected: boolean): string {
  return explicitRole || inferredRole || (hasAriaSelected ? "option" : "");
}

export function normalizeOptionRecoveryText(value: string | null | undefined): string {
  return value?.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase() ?? "";
}

export function isExactOptionRecoveryMatch(
  optionText: string | null | undefined,
  candidateText: string | null | undefined,
): boolean {
  const normalizedOption = normalizeOptionRecoveryText(optionText);
  return Boolean(normalizedOption && normalizedOption === normalizeOptionRecoveryText(candidateText));
}

export function resolveMultipleState(element: {
  multiple?: boolean;
  ariaMultiselectable?: string | null;
  ownerAriaMultiselectable?: string | null;
}): boolean | undefined {
  if (element.multiple === true
    || element.ariaMultiselectable === "true"
    || element.ownerAriaMultiselectable === "true") return true;
  return undefined;
}

export function resolveCurrentState(ariaCurrent: string | null | undefined): boolean | undefined {
  if (!ariaCurrent || ariaCurrent === "false") return undefined;
  return true;
}

export function resolvePaginationRelation(input: {
  rel?: string | null;
  ariaLabel?: string | null;
  title?: string | null;
  text?: string | null;
  withinNavigation?: boolean;
}): "next" | "previous" | undefined {
  const relTokens = input.rel?.toLocaleLowerCase().split(/\s+/u) ?? [];
  if (relTokens.includes("next")) return "next";
  if (relTokens.includes("prev") || relTokens.includes("previous")) return "previous";
  if (!input.withinNavigation) return undefined;
  const accessibleName = [input.ariaLabel, input.title, input.text]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase();
  if (/^(?:next|next page|下一页|下页|后一页|›|»|→)$/u.test(accessibleName)) return "next";
  if (/^(?:previous|previous page|prev|上一页|上页|前一页|‹|«|←)$/u.test(accessibleName)) return "previous";
  return undefined;
}
