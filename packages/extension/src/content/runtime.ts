import type {
  ActionExecutionResult,
  ActionVerification,
  BrowserActionPlan,
  BrowserActionStep,
  PageElementSnapshot,
  PageSnapshot,
  PerformanceSnapshot,
  RecordedBrowserAction,
  PageSnapshotDiff,
} from "@auto-page-agent/shared";
import { hideAgentFrame, setAgentActivity, showAgentFrame, showAiPointer } from "./agent-activity.js";
import { getActionSettlePolicy, getDelayedActionObservationPolicy } from "./action-settle.js";
import { getPageTransitionState, hasObservableActionEffect, hasVerifiedDismissal, hasVerifiedOptionSelection, isOptionSnapshot } from "./action-verification.js";
import { clickSafePopupExterior, dispatchEscapeKey, isPopupDismissTargetOpen } from "./dismiss.js";
import { replayRecordedActions, setRecordingActive } from "./recording.js";
import { clearElementSelection, startElementSelection } from "./selection.js";
import { buildSelector, buildSimplifiedDom, cleanText, collectPageInfo, createElementFingerprint, delay, getAccessibleLabel, getSelectedValues, inferRole, isAvailableOption, isComboboxLike, isDisabledElement, isHiddenInput, isNearViewport, isReadonlyElement, isSensitiveElement, isTopLayerElement, isVisible, round, setElementValue, shouldExposeValue, simulateClick } from "./dom.js";
import { getSnapshotCandidatePriority, parseAriaIdRefs, resolveSnapshotRole, shouldIncludeSnapshotCandidate, SNAPSHOT_CANDIDATE_SELECTOR } from "./snapshot-policy.js";

const elementRefs = new Map<string, Element>();
let currentSnapshotId = "";
let currentSnapshotUrl = "";
let currentSnapshot: PageSnapshot | null = null;
let domVersion = 0;

new MutationObserver((records) => {
  if (records.some((record) => !(record.target instanceof Element) || !record.target.closest("[data-auto-page-agent-overlay]"))) domVersion += 1;
}).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "page.snapshot") {
    sendResponse(createPageSnapshot(message.includePerformance === true));
    return false;
  }
  if (message?.type === "page.actions.execute") {
    void executePlan(message.plan as BrowserActionPlan).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }
  if (message?.type === "page.agent.activity") {
    setAgentActivity(Boolean(message.active));
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "page.selection.start") {
    startElementSelection(message.mode === "image" ? "image" : "element");
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "page.selection.clear") {
    clearElementSelection();
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "page.performance") {
    sendResponse(collectPerformance());
    return false;
  }
  if (message?.type === "page.recording.start") {
    setRecordingActive(true);
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "page.recording.stop") {
    setRecordingActive(false);
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "page.recording.replay") {
    void replayRecordedActions(message.actions as RecordedBrowserAction[]).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }
  return false;
});



function createPageSnapshot(includePerformance = false): PageSnapshot {
  currentSnapshotId = `${Date.now()}-${crypto.randomUUID()}`;
  currentSnapshotUrl = location.href;
  elementRefs.clear();
  const candidates = Array.from(document.querySelectorAll(SNAPSHOT_CANDIDATE_SELECTOR));
  const elements: PageElementSnapshot[] = [];
  const fingerprintCounts = new Map<string, number>();
  const previousByFingerprint = new Map(currentSnapshot?.elements.map((element) => [element.fingerprint, element]) ?? []);
  const expandedControls = candidates.filter((element) =>
    isComboboxLike(element) && element.getAttribute("aria-expanded") === "true");
  const relatedElements = collectRelatedElements(expandedControls);
  const rankedCandidates = candidates.flatMap((element, domOrder) => {
    if (!shouldIncludeSnapshotCandidate({
      visible: isVisible(element),
      nearViewport: isNearViewport(element, 700),
      hiddenInput: isHiddenInput(element),
      topLayer: isTopLayerElement(element),
      disabled: isDisabledElement(element),
      readonly: isReadonlyElement(element),
    })) return [];
    const fingerprint = createElementFingerprint(element);
    const occurrence = (fingerprintCounts.get(fingerprint) ?? 0) + 1;
    fingerprintCounts.set(fingerprint, occurrence);
    const stableFingerprint = `${fingerprint}-${occurrence}`;
    const role = resolveSnapshotRole(element.getAttribute("role"), inferRole(element), element.hasAttribute("aria-selected"));
    const previous = previousByFingerprint.get(stableFingerprint);
    const changedOrAdded = !previous || snapshotStateChanged(previous, element);
    return [{
      element,
      domOrder,
      role,
      stableFingerprint,
      priority: getSnapshotCandidatePriority({
        expandedControl: expandedControls.includes(element),
        relatedToExpandedControl: relatedElements.has(element),
        visiblePopup: ["dialog", "listbox", "menu"].includes(role),
        inViewport: isNearViewport(element, 0),
        changedOrAdded,
        nearViewport: true,
      }),
    }];
  }).sort((left, right) => left.priority - right.priority || left.domOrder - right.domOrder).slice(0, 200);

  for (const { element, role, stableFingerprint } of rankedCandidates) {
    const occurrence = Number(stableFingerprint.slice(stableFingerprint.lastIndexOf("-") + 1));
    const fingerprint = stableFingerprint.slice(0, stableFingerprint.lastIndexOf("-"));
    const ref = `el-${fingerprint}-${occurrence}`;
    elementRefs.set(ref, element);
    const html = element as HTMLElement;
    const input = element as HTMLInputElement;
    const rect = element.getBoundingClientRect();
    const selectedValues = getSelectedValues(element);
    elements.push({
      ref,
      tagName: element.tagName.toLowerCase(),
      role,
      label: getAccessibleLabel(element),
      text: cleanText(html.innerText || element.textContent || "", 300),
      selector: buildSelector(element),
      value: shouldExposeValue(input) ? cleanText(String(input.value ?? ""), 500) : undefined,
      ...(selectedValues.length ? {
        selectedValues,
        displayValue: cleanText(selectedValues.join(", "), 500),
      } : {}),
      href: element instanceof HTMLAnchorElement ? element.href : undefined,
      placeholder: input.placeholder || undefined,
      inputType: input.type || undefined,
      disabled: isDisabledElement(element),
      sensitive: isSensitiveElement(element),
      contentEditable: html.isContentEditable,
      fingerprint: stableFingerprint,
      inViewport: isNearViewport(element, 0),
      occluded: !isTopLayerElement(element),
      readonly: isReadonlyElement(element),
      ...(element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type) ? { checked: element.checked } : {}),
      ...(element.hasAttribute("aria-selected") ? { selected: element.getAttribute("aria-selected") === "true" } : {}),
      ...(element.hasAttribute("aria-expanded") ? { expanded: element.getAttribute("aria-expanded") === "true" } : {}),
      ...(element.hasAttribute("aria-busy") ? { busy: element.getAttribute("aria-busy") === "true" } : {}),
      ...(element.id ? { domId: element.id } : {}),
      ...(element.getAttribute("aria-controls") ? { controls: element.getAttribute("aria-controls") ?? undefined } : {}),
      ...(element.getAttribute("aria-owns") ? { owns: element.getAttribute("aria-owns") ?? undefined } : {}),
      ...(element.getAttribute("aria-activedescendant") ? { activeDescendant: element.getAttribute("aria-activedescendant") ?? undefined } : {}),
      ...resolveSemanticOwnerId(element),
      viewportRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    });
  }

  const pageInfo = collectPageInfo();
  const simplifiedDom = buildSimplifiedDom(elements, elementRefs);
  const snapshot: PageSnapshot = {
    snapshotId: currentSnapshotId,
    url: location.href,
    title: document.title,
    language: document.documentElement.lang || navigator.language,
    selectedText: cleanText(getSelection()?.toString() ?? "", 12_000),
    headings: Array.from(document.querySelectorAll("h1,h2,h3"))
      .filter(isVisible)
      .slice(0, 80)
      .map((heading) => ({ level: Number(heading.tagName[1]), text: cleanText(heading.textContent ?? "", 300) })),
    mainText: cleanText((document.querySelector("main,article") ?? document.body).textContent ?? "", 20_000),
    simplifiedDom,
    pageInfo,
    elements,
    ...(includePerformance ? { performance: collectPerformance() } : {}),
    capturedAt: new Date().toISOString(),
    domVersion,
  };
  currentSnapshot = snapshot;
  return snapshot;
}

function collectPerformance(): PerformanceSnapshot {
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const resources = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
    .map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      duration: round(entry.duration),
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
    }))
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 100);
  return {
    navigation: navigation
      ? {
          ttfb: round(navigation.responseStart - navigation.requestStart),
          domContentLoaded: round(navigation.domContentLoadedEventEnd),
          load: round(navigation.loadEventEnd),
        }
      : undefined,
    resources,
    apiRequests: resources
      .filter((resource): resource is typeof resource & { initiatorType: "fetch" | "xmlhttprequest" } => resource.initiatorType === "fetch" || resource.initiatorType === "xmlhttprequest")
      .flatMap((resource) => {
        try {
          const url = new URL(resource.name);
          return [{ url: `${url.origin}${url.pathname}`, pathname: url.pathname, initiatorType: resource.initiatorType, duration: resource.duration, transferSize: resource.transferSize }];
        } catch { return []; }
      })
      .slice(0, 30),
    summary: {
      requestCount: resources.length,
      totalTransferSize: resources.reduce((total, resource) => total + resource.transferSize, 0),
      slowRequestCount: resources.filter((resource) => resource.duration > 1_000).length,
    },
  };
}

async function executePlan(plan: BrowserActionPlan): Promise<ActionExecutionResult> {
  if (plan.snapshotId !== currentSnapshotId) throw new Error("Page snapshot expired. Read the page again.");
  if (location.href !== currentSnapshotUrl) throw new Error("Page URL changed after the snapshot. Read the page again.");
  const before = currentSnapshot;
  if (!before) throw new Error("No current page snapshot is available.");
  const step = plan.steps[0];
  if (!step) throw new Error("The action plan is empty.");
  showAgentFrame();
  const targetFingerprint = step.targetRef ? before.elements.find((element) => element.ref === step.targetRef)?.fingerprint : undefined;
  const targetElement = step.targetRef ? elementRefs.get(step.targetRef) : undefined;
  try {
    const results = [await executeStep(step)];
    await waitForActionSettled(step, targetElement);
    let after = createPageSnapshot();
    let diff = diffSnapshots(before, after);
    let verification = verifyAction(step, before, after, diff, targetFingerprint);
    const routeTransitionObserved = isNavigationAction(step)
      && getPageTransitionState(before, after, diff) === "pending";
    if (!verification.success || routeTransitionObserved) {
      const delayedObservation = await observeDelayedActionEffect(
        step,
        before,
        targetFingerprint,
        routeTransitionObserved,
      );
      if (delayedObservation) {
        ({ snapshot: after, diff, verification } = delayedObservation);
      }
    }
    return { ok: verification.success, results, snapshot: after, verification, ...(!verification.success ? { error: verification.summary } : {}) };
  } finally {
    hideAgentFrame(650);
  }
}

async function observeDelayedActionEffect(
  step: BrowserActionStep,
  before: PageSnapshot,
  targetFingerprint?: string,
  routeTransitionObserved = false,
): Promise<{
  snapshot: PageSnapshot;
  diff: PageSnapshotDiff;
  verification: ActionVerification;
} | undefined> {
  const policy = routeTransitionObserved
    ? { maxWaitMs: 5_000, quietMs: 250, pollMs: 100 }
    : getDelayedActionObservationPolicy(step.action);
  if (!policy) return undefined;
  const startedAt = Date.now();
  let lastVersion = domVersion;
  let quietSince = startedAt;
  let pageChanged = false;
  let waitingForRouteTransition = routeTransitionObserved;

  while (Date.now() - startedAt < policy.maxWaitMs) {
    await delay(policy.pollMs);
    if (domVersion !== lastVersion) {
      lastVersion = domVersion;
      quietSince = Date.now();
      pageChanged = true;
    }
    const urlChanged = location.href !== before.url;
    pageChanged ||= urlChanged;
    if (!pageChanged || (!urlChanged && Date.now() - quietSince < policy.quietMs)) continue;

    const snapshot = createPageSnapshot();
    const diff = diffSnapshots(before, snapshot);
    waitingForRouteTransition ||= isNavigationAction(step)
      && getPageTransitionState(before, snapshot, diff) === "pending";
    const verification = verifyObservedAction(
      step,
      before,
      snapshot,
      diff,
      targetFingerprint,
      waitingForRouteTransition,
    );
    if (verification.success) return { snapshot, diff, verification };
    pageChanged = false;
    lastVersion = domVersion;
    quietSince = Date.now();
  }

  const snapshot = createPageSnapshot();
  const diff = diffSnapshots(before, snapshot);
  waitingForRouteTransition ||= isNavigationAction(step)
    && getPageTransitionState(before, snapshot, diff) === "pending";
  const verification = verifyObservedAction(
    step,
    before,
    snapshot,
    diff,
    targetFingerprint,
    waitingForRouteTransition,
  );
  return { snapshot, diff, verification };
}

function verifyObservedAction(
  step: BrowserActionStep,
  before: PageSnapshot,
  snapshot: PageSnapshot,
  diff: PageSnapshotDiff,
  targetFingerprint: string | undefined,
  routeTransitionObserved: boolean,
): ActionVerification {
  if (routeTransitionObserved) {
    const success = getPageTransitionState(before, snapshot, diff) === "completed";
    return {
      success,
      summary: success
        ? "The route transition completed and the new page context was observed."
        : "A route transition started, but the destination page is not ready yet.",
      changes: diff.summary,
      diff,
      ...(success ? { routeTransitioned: true } : {}),
    };
  }
  return verifyAction(step, before, snapshot, diff, targetFingerprint);
}

function isNavigationAction(step: BrowserActionStep): boolean {
  return step.action === "click" || step.action === "submit";
}

async function waitForActionSettled(step: BrowserActionStep, target?: Element): Promise<void> {
  const comboboxClick = step.action === "click" && Boolean(target && isComboboxLike(target));
  const { maxWaitMs, minWaitMs = 0, pollMs = 80, quietMs, waitForOption = false } =
    getActionSettlePolicy(step.action, { comboboxClick });
  const start = Date.now();
  let lastVersion = domVersion;
  let quietSince = Date.now();
  let optionAvailable = !waitForOption;
  while (Date.now() - start < maxWaitMs) {
    await delay(pollMs);
    if (domVersion !== lastVersion) { lastVersion = domVersion; quietSince = Date.now(); }
    if (waitForOption && !optionAvailable) {
      optionAvailable = (target ? resolveControlledRoots(target) : []).some((root) => {
        if (isAvailableOption(root)) return true;
        return Array.from(root.querySelectorAll('[role="option"],[aria-selected]')).some(isAvailableOption);
      });
    }
    if (Date.now() - start >= minWaitMs && optionAvailable && Date.now() - quietSince >= quietMs) return;
  }
}

function collectRelatedElements(controls: Element[]): Set<Element> {
  const related = new Set<Element>();
  for (const control of controls) {
    related.add(control);
    for (const root of resolveControlledRoots(control)) {
      related.add(root);
      for (const element of root.querySelectorAll(SNAPSHOT_CANDIDATE_SELECTOR)) related.add(element);
    }
    for (const id of parseAriaIdRefs(control.getAttribute("aria-activedescendant"))) {
      const active = document.getElementById(id);
      if (active) related.add(active);
    }
  }
  return related;
}

function resolveControlledRoots(control: Element): Element[] {
  const ids = [
    ...parseAriaIdRefs(control.getAttribute("aria-controls")),
    ...parseAriaIdRefs(control.getAttribute("aria-owns")),
  ];
  return ids.flatMap((id) => {
    const root = document.getElementById(id);
    return root ? [root] : [];
  });
}

function resolveSemanticOwnerId(element: Element): { ownerId?: string } {
  const owner = element.closest('[role="listbox"],[role="menu"]');
  return owner?.id ? { ownerId: owner.id } : {};
}

function snapshotStateChanged(previous: PageElementSnapshot, element: Element): boolean {
  const input = element as HTMLInputElement;
  const selectedValues = getSelectedValues(element);
  return JSON.stringify([
    previous.value,
    previous.displayValue,
    previous.selectedValues,
    previous.checked,
    previous.selected,
    previous.expanded,
    previous.busy,
  ]) !== JSON.stringify([
    shouldExposeValue(input) ? cleanText(String(input.value ?? ""), 500) : undefined,
    selectedValues.length ? cleanText(selectedValues.join(", "), 500) : undefined,
    selectedValues.length ? selectedValues : undefined,
    element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type) ? element.checked : undefined,
    element.hasAttribute("aria-selected") ? element.getAttribute("aria-selected") === "true" : undefined,
    element.hasAttribute("aria-expanded") ? element.getAttribute("aria-expanded") === "true" : undefined,
    element.hasAttribute("aria-busy") ? element.getAttribute("aria-busy") === "true" : undefined,
  ]);
}

export function diffSnapshots(before: PageSnapshot, after: PageSnapshot): PageSnapshotDiff {
  const beforeById = new Map(before.elements.map((element) => [element.fingerprint, element]));
  const afterById = new Map(after.elements.map((element) => [element.fingerprint, element]));
  const addedFingerprints = [...afterById.keys()].filter((key) => !beforeById.has(key));
  const removedFingerprints = [...beforeById.keys()].filter((key) => !afterById.has(key));
  const changedFingerprints = [...afterById.keys()].filter((key) => {
    const previous = beforeById.get(key);
    const next = afterById.get(key);
    return previous && next && JSON.stringify([previous.value, previous.displayValue, previous.selectedValues, previous.disabled, previous.checked, previous.selected, previous.expanded, previous.busy, previous.occluded]) !== JSON.stringify([next.value, next.displayValue, next.selectedValues, next.disabled, next.checked, next.selected, next.expanded, next.busy, next.occluded]);
  });
  const summary = [
    before.url !== after.url ? `URL changed to ${after.url}` : "",
    before.title !== after.title ? "Page title changed" : "",
    addedFingerprints.length ? `${addedFingerprints.length} interactive element(s) added` : "",
    removedFingerprints.length ? `${removedFingerprints.length} interactive element(s) removed` : "",
    changedFingerprints.length ? `${changedFingerprints.length} element state(s) changed` : "",
  ].filter(Boolean);
  return { urlChanged: before.url !== after.url, titleChanged: before.title !== after.title, addedFingerprints, removedFingerprints, changedFingerprints, summary };
}

function verifyAction(step: BrowserActionStep, before: PageSnapshot, snapshot: PageSnapshot, diff: PageSnapshotDiff, targetFingerprint?: string): ActionVerification {
  const target = targetFingerprint ? snapshot.elements.find((element) => element.fingerprint === targetFingerprint) : undefined;
  let success = true;
  let summary = "Action dispatched and page observation completed.";
  if (step.action === "fill" || step.action === "select") {
    success = Boolean(target && target.value === (step.value ?? ""));
    summary = success ? "The target value matches the requested value." : "The target value did not match after the action.";
  } else if (step.action === "click" && isOptionSnapshot(before.elements.find((element) => element.fingerprint === targetFingerprint))) {
    success = Boolean(targetFingerprint && hasVerifiedOptionSelection(before, snapshot, targetFingerprint));
    summary = success ? "The option selection changed the combobox state." : "The option click did not produce a verified selection state.";
  } else if (step.action === "dismiss") {
    success = Boolean(targetFingerprint && hasVerifiedDismissal(before, snapshot, targetFingerprint));
    summary = success ? "The inner popup was verified as dismissed." : "The dismiss action did not produce a verified collapsed or hidden state.";
  } else if (step.action === "focus") {
    const active = document.activeElement;
    success = Boolean(active && createElementFingerprint(active) === targetFingerprint?.split("-")[0]);
    summary = success ? "The target received focus." : "The target did not retain focus.";
  } else if (step.action === "scroll") {
    success = hasObservableActionEffect(step, before, snapshot, diff, targetFingerprint);
    summary = success ? "The viewport position changed after scrolling." : "The viewport did not move after the scroll action.";
  } else {
    success = hasObservableActionEffect(step, before, snapshot, diff, targetFingerprint);
    summary = success ? diff.summary.join("; ") : "The action produced no observable page change.";
  }
  return { success, summary, changes: diff.summary, diff };
}

async function executeStep(step: BrowserActionStep): Promise<{ action: string; ok: true }> {
  if (!["click", "fill", "select", "scroll", "focus", "submit", "dismiss"].includes(step.action)) throw new Error("Unsupported browser action.");
  if (step.action === "scroll") {
    const amount = Math.min(Math.max(step.amountPx ?? 600, 0), 2_000);
    if (step.direction === "top") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return { action: step.action, ok: true };
    }
    if (step.direction === "bottom") {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
      return { action: step.action, ok: true };
    }
    const sign = step.direction === "up" || step.direction === "left" ? -1 : 1;
    window.scrollBy({ top: step.direction === "left" || step.direction === "right" ? 0 : amount * sign, left: step.direction === "left" || step.direction === "right" ? amount * sign : 0, behavior: "smooth" });
    return { action: step.action, ok: true };
  }
  const element = step.targetRef ? elementRefs.get(step.targetRef) : undefined;
  if (!(element instanceof HTMLElement) || !isVisible(element)) throw new Error(`Target is unavailable: ${step.targetRef ?? "missing"}`);
  if (isSensitiveElement(element) && (step.action === "fill" || step.action === "select")) throw new Error("Sensitive fields cannot be filled by the agent.");
  if (isDisabledElement(element)) throw new Error("Target is disabled.");
  if (isReadonlyElement(element) && (step.action === "fill" || step.action === "select")) throw new Error("Target is readonly.");
  if (step.action === "fill" && isComboboxLike(element)) {
    throw new Error("Custom comboboxes must be clicked and selected from a fresh option snapshot.");
  }
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  await delay(220);
  if (!isTopLayerElement(element)) throw new Error("Target is covered by another page element.");
  await showAiPointer(element, `AI · ${step.action}`);
  if (step.action === "click") await simulateClick(element);
  if (step.action === "dismiss") await dismissElement(element, step.allowDialogDismiss === true);
  if (step.action === "focus") element.focus();
  if (step.action === "submit") {
    const form = element.closest("form");
    if (form) form.requestSubmit();
    else await simulateClick(element);
  }
  if (step.action === "fill") setElementValue(element, step.value ?? "");
  if (step.action === "select") {
    if (!(element instanceof HTMLSelectElement)) {
      throw new Error("Select only supports native select elements. Use fill, reobserve, and click for a custom combobox.");
    }
    setElementValue(element, step.value ?? "");
  }
  return { action: step.action, ok: true };
}

async function dismissElement(element: HTMLElement, allowFilledDialog: boolean): Promise<void> {
  const role = element.getAttribute("role") || inferRole(element);
  if (role === "combobox") {
    if (element.getAttribute("aria-expanded") !== "true") {
      throw new Error("Only an expanded combobox can be dismissed.");
    }
    if (clickSafePopupExterior(element)) {
      await delay(250);
      if (!isPopupDismissTargetOpen(element)) return;
    }
  } else if (role === "listbox" || role === "menu") {
    if (clickSafePopupExterior(element)) {
      await delay(250);
      if (!isPopupDismissTargetOpen(element)) return;
    }
  } else if (role === "dialog") {
    const innerPopupOpen = Array.from(document.querySelectorAll(
      '[role="combobox"][aria-expanded="true"],[role="listbox"],[role="menu"]',
    )).some((candidate) => candidate !== element && isVisible(candidate) && isTopLayerElement(candidate));
    if (innerPopupOpen) throw new Error("Dismiss the innermost popup before the outer dialog.");
    if (getTopmostVisibleDialog() !== element) throw new Error("Only the topmost dialog can be dismissed.");
    if (dialogContainsFilledContent(element) && !allowFilledDialog) {
      throw new Error("A dialog with filled content cannot be automatically dismissed. Use its explicit close control.");
    }
  } else {
    throw new Error("Dismiss only supports an expanded combobox, visible listbox/menu, or topmost dialog.");
  }

  dispatchEscapeKey(element);
}

function getTopmostVisibleDialog(): HTMLElement | undefined {
  return Array.from(document.querySelectorAll('[role="dialog"]'))
    .filter((element): element is HTMLElement =>
      element instanceof HTMLElement && isVisible(element) && isTopLayerElement(element))
    .sort((left, right) => {
      const depthDifference = elementDepth(left) - elementDepth(right);
      if (depthDifference) return depthDifference;
      const zDifference = numericZIndex(left) - numericZIndex(right);
      if (zDifference) return zDifference;
      return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    })
    .at(-1);
}

function elementDepth(element: Element): number {
  let depth = 0;
  for (let current = element.parentElement; current; current = current.parentElement) depth += 1;
  return depth;
}

function numericZIndex(element: Element): number {
  const value = Number.parseInt(getComputedStyle(element).zIndex, 10);
  return Number.isFinite(value) ? value : 0;
}

function dialogContainsFilledContent(dialog: HTMLElement): boolean {
  return Array.from(dialog.querySelectorAll('input,textarea,select,[contenteditable="true"]'))
    .some((candidate) => {
      if (candidate instanceof HTMLInputElement) {
        if (["checkbox", "radio"].includes(candidate.type)) return candidate.checked;
        return Boolean(candidate.value.trim());
      }
      if (candidate instanceof HTMLTextAreaElement || candidate instanceof HTMLSelectElement) {
        return Boolean(candidate.value.trim());
      }
      return Boolean(candidate.textContent?.trim());
    });
}
