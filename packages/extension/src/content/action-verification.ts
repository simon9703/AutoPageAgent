import type { BrowserActionStep, PageSnapshot, PageSnapshotDiff } from "@auto-page-agent/shared";

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
