export type ReobserveReason =
  | "page_url_changed"
  | "page_context_changed"
  | "snapshot_expired"
  | "page_context_invalidated";

export interface ReobserveSignal {
  reason: ReobserveReason;
  summary: string;
  actionMayHaveExecuted: boolean;
}

export function classifyReobserveError(error: unknown): ReobserveSignal | undefined {
  const message = error instanceof Error ? error.message : String(error);
  if (/page url changed after the snapshot/iu.test(message)) {
    return {
      reason: "page_url_changed",
      summary: "The page URL changed after the snapshot, so the stale action was discarded.",
      actionMayHaveExecuted: false,
    };
  }
  if (/page snapshot expired/iu.test(message)) {
    return {
      reason: "snapshot_expired",
      summary: "The page snapshot expired, so the stale action was discarded.",
      actionMayHaveExecuted: false,
    };
  }
  if (/target is unavailable:/iu.test(message)) {
    return {
      reason: "snapshot_expired",
      summary: "The target changed or disappeared after the snapshot, so the page must be observed again.",
      actionMayHaveExecuted: false,
    };
  }
  if (
    /message port closed|could not establish connection|receiving end does not exist|cannot access contents|context invalidated|frame (?:was )?removed|no frame with id/iu
      .test(message)
  ) {
    return {
      reason: "page_context_invalidated",
      summary: "The page context was replaced during the action, so the new document must be observed.",
      actionMayHaveExecuted: true,
    };
  }
  return undefined;
}

export function consumeReobserveStep(iteration: number, signal: ReobserveSignal): number {
  return iteration + (signal.actionMayHaveExecuted ? 1 : 0);
}
