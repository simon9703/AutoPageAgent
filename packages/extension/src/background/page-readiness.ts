import type { AgentLoopContext, PageElementSnapshot, PageSnapshot } from "@auto-page-agent/shared";

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_QUIET_WINDOW_MS = 500;

export interface PageReadinessOptions {
  timeoutMs: number;
  pollIntervalMs?: number;
  quietWindowMs?: number;
  now?: () => number;
  wait?: (delayMs: number) => Promise<void>;
}

export function getBlockedRecoveryBoundary(loop: AgentLoopContext): string | undefined {
  if (!loop.lastAction && !loop.reobserve) return undefined;
  return [
    loop.iteration,
    loop.lastAction?.action ?? "observe",
  ].join(":");
}

export function semanticSnapshotSignature(snapshot: PageSnapshot): string {
  return JSON.stringify({
    url: snapshot.url,
    title: normalizeText(snapshot.title),
    headings: snapshot.headings.map(({ level, text }) => [level, normalizeText(text)]),
    mainText: normalizeText(snapshot.mainText).slice(0, 12_000),
    elements: snapshot.elements.map(semanticElement),
  });
}

export function hasVisibleBusyState(snapshot: PageSnapshot): boolean {
  return snapshot.elements.some((element) => (
    !element.occluded
    && (element.busy === true || element.role === "progressbar")
  ));
}

export async function waitForPageDecisionReadiness(
  baseline: PageSnapshot,
  readSnapshot: () => Promise<PageSnapshot>,
  options: PageReadinessOptions,
): Promise<PageSnapshot | undefined> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const quietWindowMs = options.quietWindowMs ?? DEFAULT_QUIET_WINDOW_MS;
  const baselineSignature = semanticSnapshotSignature(baseline);
  const deadline = now() + Math.max(0, options.timeoutMs);
  let latestChanged: PageSnapshot | undefined;
  let latestSignature = baselineSignature;
  let changedAt = 0;

  while (now() < deadline) {
    await wait(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
    let snapshot: PageSnapshot;
    try {
      snapshot = await readSnapshot();
    } catch {
      continue;
    }
    const signature = semanticSnapshotSignature(snapshot);
    if (signature === baselineSignature) continue;
    latestChanged = snapshot;
    if (signature !== latestSignature) {
      latestSignature = signature;
      changedAt = now();
      continue;
    }
    if (!hasVisibleBusyState(snapshot) && now() - changedAt >= quietWindowMs) return snapshot;
  }
  return latestChanged;
}

function semanticElement(element: PageElementSnapshot) {
  return {
    fingerprint: element.fingerprint,
    tagName: element.tagName,
    role: element.role,
    label: normalizeText(element.label),
    text: normalizeText(element.text),
    value: normalizeText(element.value ?? ""),
    displayValue: normalizeText(element.displayValue ?? ""),
    selectedValues: element.selectedValues?.map(normalizeText) ?? [],
    href: element.href ?? "",
    disabled: element.disabled,
    readonly: element.readonly,
    checked: element.checked,
    selected: element.selected,
    expanded: element.expanded,
    busy: element.busy,
  };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
