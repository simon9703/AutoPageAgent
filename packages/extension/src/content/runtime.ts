import type {
  ActionExecutionResult,
  ActionVerification,
  BrowserActionPlan,
  BrowserActionStep,
  PageElementSnapshot,
  PageSnapshot,
  PerformanceSnapshot,
  PopupHousekeepingRequest,
  PopupHousekeepingResult,
  RecordedBrowserAction,
  PageSnapshotDiff,
} from "@auto-page-agent/shared";
import { hideAgentFrame, setAgentActivity, showAgentFrame, showAiPointer, showAiPointerAtPoint } from "./agent-activity.js";
import { getActionSettlePolicy, getDelayedActionObservationPolicy } from "./action-settle.js";
import { getPageTransitionState, hasObservableActionEffect, hasVerifiedDismissal, hasVerifiedOptionSelection, hasVerifiedPaginationChange, isOptionSnapshot } from "./action-verification.js";
import { clickSafePopupExterior, dismissPopupWithFallbacks, dispatchEscapeKey, isPopupDismissTargetOpen } from "./dismiss.js";
import { replayRecordedActions, setRecordingActive } from "./recording.js";
import { clearElementSelection, startElementSelection } from "./selection.js";
import { buildSelector, buildSimplifiedDom, cleanText, collectPageInfo, createElementFingerprint, delay, getAccessibleLabel, getSelectedValues, inferRole, isAvailableOption, isComboboxLike, isDisabledElement, isHiddenInput, isNearViewport, isReadonlyElement, isSensitiveElement, isTopLayerElement, isVisible, round, setElementValue, shouldExposeValue, simulateClick } from "./dom.js";
import { getSnapshotCandidatePriority, isExactOptionRecoveryMatch, parseAriaIdRefs, resolveCurrentState, resolveMultipleState, resolvePaginationRelation, resolveSnapshotRole, shouldIncludeSnapshotCandidate, SNAPSHOT_CANDIDATE_SELECTOR } from "./snapshot-policy.js";
import { collectVisualSignals } from "./visual-signals.js";

const elementRefs = new Map<string, Element>();
const recoveredOptionRefs = new Map<string, RecoveredOption>();
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
  if (message?.type === "page.snapshot.validate") {
    sendResponse({
      valid: message.snapshotId === currentSnapshotId
        && message.url === currentSnapshotUrl
        && location.href === currentSnapshotUrl
        && message.domVersion === domVersion,
    });
    return false;
  }
  if (message?.type === "page.actions.execute") {
    void executePlan(message.plan as BrowserActionPlan).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }
  if (message?.type === "page.popup.dismiss") {
    void executePopupHousekeeping(message.request as PopupHousekeepingRequest).then(sendResponse).catch((error) => {
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
  recoveredOptionRefs.clear();
  const baseCandidates = collectSnapshotCandidates();
  const expandedControls = baseCandidates.filter((element) =>
    isComboboxLike(element) && element.getAttribute("aria-expanded") === "true");
  const recoveredOptions = collectRecoveredOptions(expandedControls);
  const candidates = [...new Set([...baseCandidates, ...recoveredOptions.keys()])];
  const elements: PageElementSnapshot[] = [];
  const fingerprintCounts = new Map<string, number>();
  const previousByFingerprint = new Map(currentSnapshot?.elements.map((element) => [element.fingerprint, element]) ?? []);
  const relatedElements = collectRelatedElements(expandedControls);
  for (const element of recoveredOptions.keys()) relatedElements.add(element);
  const popupSemanticKeys = new Set([...relatedElements]
    .filter((element) => ["option", "menuitem"].includes(
      resolveSnapshotRole(element.getAttribute("role"), inferRole(element), element.hasAttribute("aria-selected")),
    ))
    .map((element) => semanticCandidateKey(element))
    .filter(Boolean));
  const topmostDialog = candidates.filter((element) =>
    element.getAttribute("role") === "dialog" && isVisible(element) && isTopLayerElement(element)).at(-1);
  const rankedCandidates = candidates.flatMap((element, domOrder) => {
    const recoveredOption = recoveredOptions.get(element);
    if (topmostDialog
      && element !== topmostDialog
      && !topmostDialog.contains(element)
      && !relatedElements.has(element)) return [];
    if (expandedControls.length
      && !relatedElements.has(element)
      && popupSemanticKeys.has(semanticCandidateKey(element))) return [];
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
    const role = recoveredOption
      ? "option"
      : resolveSnapshotRole(element.getAttribute("role"), inferRole(element), element.hasAttribute("aria-selected"));
    const previous = previousByFingerprint.get(stableFingerprint);
    const changedOrAdded = !previous || snapshotStateChanged(previous, element);
    const scrollOnlyCandidate = Boolean(
      getScrollablePosition(element)
      && !element.matches(SNAPSHOT_CANDIDATE_SELECTOR),
    );
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
      }) + (scrollOnlyCandidate ? 2 : 0),
    }];
  }).sort((left, right) => left.priority - right.priority || left.domOrder - right.domOrder).slice(0, 200);

  for (const { element, role, stableFingerprint } of rankedCandidates) {
    const recoveredOption = recoveredOptions.get(element);
    const occurrence = Number(stableFingerprint.slice(stableFingerprint.lastIndexOf("-") + 1));
    const fingerprint = stableFingerprint.slice(0, stableFingerprint.lastIndexOf("-"));
    const ref = `el-${fingerprint}-${occurrence}`;
    elementRefs.set(ref, element);
    if (recoveredOption) recoveredOptionRefs.set(ref, recoveredOption);
    const html = element as HTMLElement;
    const input = element as HTMLInputElement;
    const rect = element.getBoundingClientRect();
    const selectedValues = getSelectedValues(element);
    const owner = recoveredOption?.owner ?? element.closest('[role="listbox"],[role="menu"]');
    const controlledRoots = isComboboxLike(element) ? resolveControlledRoots(element) : [];
    const scrollPosition = getScrollablePosition(element);
    const layer = resolveLayerMetadata(element, role, expandedControls, recoveredOption?.owner);
    const relation = resolvePaginationRelation({
      rel: element.getAttribute("rel"),
      ariaLabel: element.getAttribute("aria-label"),
      title: element.getAttribute("title"),
      text: element.textContent,
      withinNavigation: Boolean(element.closest("nav,[role='navigation']")),
    });
    elements.push({
      ref,
      tagName: element.tagName.toLowerCase(),
      role,
      label: getAccessibleLabel(element) || recoveredOption?.label || "",
      text: cleanText(html.innerText || element.textContent || recoveredOption?.label || "", 300),
      selector: buildSelector(element),
      value: shouldExposeValue(input) ? cleanText(String(input.value ?? ""), 500) : undefined,
      ...(selectedValues.length ? {
        selectedValues,
        displayValue: cleanText(selectedValues.join(", "), 500),
      } : {}),
      ...resolveMultipleState({
        multiple: element instanceof HTMLSelectElement ? element.multiple : false,
        ariaMultiselectable: element.getAttribute("aria-multiselectable"),
        ownerAriaMultiselectable: owner?.getAttribute("aria-multiselectable")
          ?? controlledRoots.find((root) => root.getAttribute("aria-multiselectable"))?.getAttribute("aria-multiselectable"),
      }) ? { multiple: true } : {},
      ...resolveCurrentState(element.getAttribute("aria-current")) ? { current: true } : {},
      ...(relation ? { relation } : {}),
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
      ...(recoveredOption
        ? { selected: recoveredOption.semanticElement.getAttribute("aria-selected") === "true" }
        : element.hasAttribute("aria-selected")
          ? { selected: element.getAttribute("aria-selected") === "true" }
          : {}),
      ...(element.hasAttribute("aria-expanded") ? { expanded: element.getAttribute("aria-expanded") === "true" } : {}),
      ...(element.hasAttribute("aria-busy") ? { busy: element.getAttribute("aria-busy") === "true" } : {}),
      ...(recoveredOption?.semanticElement.id
        ? { domId: recoveredOption.semanticElement.id }
        : element.id
          ? { domId: element.id }
          : {}),
      ...(element.getAttribute("aria-controls") ? { controls: element.getAttribute("aria-controls") ?? undefined } : {}),
      ...(element.getAttribute("aria-owns") ? { owns: element.getAttribute("aria-owns") ?? undefined } : {}),
      ...(element.getAttribute("aria-activedescendant") ? { activeDescendant: element.getAttribute("aria-activedescendant") ?? undefined } : {}),
      ...(owner?.id ? { ownerId: owner.id } : resolveSemanticOwnerId(element)),
      ...layer,
      ...(scrollPosition ? { scrollable: true, scrollPosition } : {}),
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
    visualSignals: collectVisualSignals(),
    collectionSignature: collectCollectionSignature(),
    elements,
    ...(includePerformance ? { performance: collectPerformance() } : {}),
    capturedAt: new Date().toISOString(),
    domVersion,
  };
  currentSnapshot = snapshot;
  return snapshot;
}

function semanticCandidateKey(element: Element): string {
  const role = resolveSnapshotRole(
    element.getAttribute("role"),
    inferRole(element),
    element.hasAttribute("aria-selected"),
  );
  const name = cleanText(getAccessibleLabel(element) || element.textContent || "", 300)
    .normalize("NFKC")
    .toLocaleLowerCase();
  return name ? `${role}:${name}` : "";
}

function collectSnapshotCandidates(): Element[] {
  const candidates = new Set(document.querySelectorAll(SNAPSHOT_CANDIDATE_SELECTOR));
  const potentialScrollContainers = document.querySelectorAll(
    "main,section,div,ul,ol,table,tbody,[role='region'],[role='listbox'],[role='grid']",
  );
  for (const element of Array.from(potentialScrollContainers).slice(0, 2_000)) {
    if (getScrollablePosition(element)) candidates.add(element);
  }
  return [...candidates];
}

interface RecoveredOption {
  semanticElement: Element;
  owner: Element;
  label: string;
}

function collectRecoveredOptions(controls: Element[]): Map<Element, RecoveredOption> {
  const recovered = new Map<Element, RecoveredOption>();
  for (const control of controls) {
    for (const owner of resolveControlledRoots(control)) {
      const semanticOptions = [
        ...(isSemanticOption(owner) ? [owner] : []),
        ...Array.from(owner.querySelectorAll('[role="option"],[aria-selected]')),
      ];
      for (const semanticElement of semanticOptions) {
        if (isAvailableOption(semanticElement)) continue;
        const label = cleanText(
          getAccessibleLabel(semanticElement) || semanticElement.textContent || "",
          300,
        );
        if (!label) continue;
        const proxy = findVisibleOptionProxy(owner, semanticElement, label);
        if (!proxy || recovered.has(proxy)) continue;
        recovered.set(proxy, { semanticElement, owner, label });
      }
    }
  }
  return recovered;
}

function isSemanticOption(element: Element): boolean {
  return element.getAttribute("role") === "option" || element.hasAttribute("aria-selected");
}

function findVisibleOptionProxy(owner: Element, semanticElement: Element, label: string): Element | undefined {
  let scope = owner.parentElement;
  for (let depth = 0; scope && depth < 5; depth += 1, scope = scope.parentElement) {
    if (!isVisible(scope) || !isNearViewport(scope, 700)) continue;
    const matches = Array.from(scope.querySelectorAll("*"))
      .filter((candidate) => candidate !== semanticElement)
      .filter((candidate) =>
        isExactOptionRecoveryMatch(label, getAccessibleLabel(candidate) || candidate.textContent)
        && isVisible(candidate)
        && isNearViewport(candidate, 700)
        && isTopLayerElement(candidate))
      .filter((candidate) => !Array.from(candidate.children).some((child) =>
        isExactOptionRecoveryMatch(label, getAccessibleLabel(child) || child.textContent)
        && isVisible(child)));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      const interactiveMatches = matches.filter((candidate) =>
        candidate instanceof HTMLElement
        && (candidate.tabIndex >= 0 || getComputedStyle(candidate).cursor === "pointer"));
      if (interactiveMatches.length === 1) return interactiveMatches[0];
      return undefined;
    }
  }
  return undefined;
}

function getScrollablePosition(element: Element): PageElementSnapshot["scrollPosition"] {
  if (!(element instanceof HTMLElement)) return undefined;
  const maxX = Math.max(0, element.scrollWidth - element.clientWidth);
  const maxY = Math.max(0, element.scrollHeight - element.clientHeight);
  const style = getComputedStyle(element);
  const allowsX = maxX > 1 && /auto|scroll/u.test(style.overflowX);
  const allowsY = maxY > 1 && /auto|scroll/u.test(style.overflowY);
  if (!allowsX && !allowsY) return undefined;
  return {
    x: Math.round(element.scrollLeft),
    y: Math.round(element.scrollTop),
    maxX: Math.round(maxX),
    maxY: Math.round(maxY),
  };
}

function resolveLayerMetadata(
  element: Element,
  role: string,
  expandedControls: Element[],
  popupOverride?: Element,
): Pick<PageElementSnapshot, "layerId" | "parentLayerId"> {
  const ownDialog = role === "dialog" ? element : element.closest('[role="dialog"]');
  const popup = popupOverride ?? (role === "listbox" || role === "menu"
    ? element
    : element.closest('[role="listbox"],[role="menu"]'));
  const controllingElement = popup
    ? expandedControls.find((control) => resolveControlledRoots(control).some((root) => root === popup || root.contains(popup)))
    : undefined;
  const parentDialog = controllingElement?.closest('[role="dialog"]')
    ?? (popup ? popup.closest('[role="dialog"]') : ownDialog?.parentElement?.closest('[role="dialog"]'));
  const dialogId = ownDialog
    ? `dialog:${ownDialog.id || createElementFingerprint(ownDialog)}`
    : undefined;
  const parentDialogId = parentDialog
    ? `dialog:${parentDialog.id || createElementFingerprint(parentDialog)}`
    : undefined;
  if (popup) {
    return {
      layerId: `popup:${popup.id || createElementFingerprint(popup)}`,
      ...(parentDialogId ? { parentLayerId: parentDialogId } : {}),
    };
  }
  if (role === "dialog") {
    return {
      layerId: `dialog:${element.id || createElementFingerprint(element)}`,
      ...(parentDialogId ? { parentLayerId: parentDialogId } : {}),
    };
  }
  return dialogId ? { layerId: dialogId } : {};
}

function collectCollectionSignature(): string | undefined {
  const rows = Array.from(document.querySelectorAll(
    "[role='row'],[role='listitem'],tbody > tr,ol > li,ul > li",
  ))
    .filter(isVisible)
    .slice(0, 120)
    .map((element) => cleanText(element.textContent ?? "", 500))
    .filter(Boolean);
  if (!rows.length) return undefined;
  let hash = 2166136261;
  const value = rows.join("\n");
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return `${rows.length}:${(hash >>> 0).toString(36)}`;
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

async function executePopupHousekeeping(
  request: PopupHousekeepingRequest,
): Promise<PopupHousekeepingResult> {
  if (request.snapshotId !== currentSnapshotId || location.href !== currentSnapshotUrl) {
    throw new Error("Popup housekeeping requires the latest page snapshot.");
  }
  const before = currentSnapshot;
  if (!before) throw new Error("No current page snapshot is available.");
  const target = before.elements.find((element) =>
    element.ref === request.targetRef && element.fingerprint === request.targetFingerprint);
  const element = elementRefs.get(request.targetRef);
  if (!target || !(element instanceof HTMLElement) || target.role === "dialog") {
    throw new Error("The popup housekeeping target is stale or invalid.");
  }
  try {
    await dismissElement(element, target.role, recoveredOptionRefs.get(request.targetRef));
  } catch (error) {
    const snapshot = createPageSnapshot();
    const diff = diffSnapshots(before, snapshot);
    const verification = {
      success: false,
      summary: error instanceof Error ? error.message : String(error),
      changes: diff.summary,
      diff,
    };
    return { ok: false, snapshot, verification, error: verification.summary };
  }
  const snapshot = createPageSnapshot();
  const diff = diffSnapshots(before, snapshot);
  const success = hasVerifiedDismissal(before, snapshot, request.targetFingerprint);
  const verification = {
    success,
    summary: success
      ? "The inner popup was closed while its outer dialog and filled values were preserved."
      : "Trusted Escape and the single safe outside click did not close the popup.",
    changes: diff.summary,
    diff,
  };
  return {
    ok: success,
    snapshot,
    verification,
    ...(!success ? { error: verification.summary } : {}),
  };
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
      }) || Boolean(target && collectRecoveredOptions([target]).size);
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
    previous.multiple,
    previous.current,
    previous.relation,
    previous.expanded,
    previous.busy,
    previous.scrollPosition,
  ]) !== JSON.stringify([
    shouldExposeValue(input) ? cleanText(String(input.value ?? ""), 500) : undefined,
    selectedValues.length ? cleanText(selectedValues.join(", "), 500) : undefined,
    selectedValues.length ? selectedValues : undefined,
    element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type) ? element.checked : undefined,
    element.hasAttribute("aria-selected") ? element.getAttribute("aria-selected") === "true" : undefined,
    resolveMultipleState({
      multiple: element instanceof HTMLSelectElement ? element.multiple : false,
      ariaMultiselectable: element.getAttribute("aria-multiselectable"),
      ownerAriaMultiselectable: element.closest('[role="listbox"],[role="menu"]')?.getAttribute("aria-multiselectable"),
    }),
    resolveCurrentState(element.getAttribute("aria-current")),
    resolvePaginationRelation({
      rel: element.getAttribute("rel"),
      ariaLabel: element.getAttribute("aria-label"),
      title: element.getAttribute("title"),
      text: element.textContent,
      withinNavigation: Boolean(element.closest("nav,[role='navigation']")),
    }),
    element.hasAttribute("aria-expanded") ? element.getAttribute("aria-expanded") === "true" : undefined,
    element.hasAttribute("aria-busy") ? element.getAttribute("aria-busy") === "true" : undefined,
    getScrollablePosition(element),
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
    return previous && next && JSON.stringify([
      previous.value, previous.displayValue, previous.selectedValues, previous.disabled,
      previous.checked, previous.selected, previous.multiple, previous.current, previous.relation,
      previous.expanded, previous.busy, previous.occluded, previous.layerId,
      previous.parentLayerId, previous.scrollPosition,
    ]) !== JSON.stringify([
      next.value, next.displayValue, next.selectedValues, next.disabled,
      next.checked, next.selected, next.multiple, next.current, next.relation,
      next.expanded, next.busy, next.occluded, next.layerId,
      next.parentLayerId, next.scrollPosition,
    ]);
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
  const targetBefore = targetFingerprint ? before.elements.find((element) => element.fingerprint === targetFingerprint) : undefined;
  let success = true;
  let summary = "Action dispatched and page observation completed.";
  if (step.action === "fill" || step.action === "select") {
    success = Boolean(target && target.value === (step.value ?? ""));
    summary = success ? "The target value matches the requested value." : "The target value did not match after the action.";
  } else if (step.action === "click" && isOptionSnapshot(before.elements.find((element) => element.fingerprint === targetFingerprint))) {
    success = Boolean(targetFingerprint && hasVerifiedOptionSelection(before, snapshot, targetFingerprint));
    summary = success ? "The option selection changed the combobox state." : "The option click did not produce a verified selection state.";
  } else if (step.action === "click" && targetBefore?.relation) {
    success = Boolean(targetFingerprint && hasVerifiedPaginationChange(before, snapshot, targetFingerprint));
    summary = success
      ? "Pagination changed the current page or collection content."
      : "The pagination control did not change the current page, URL, or collection.";
  } else if (step.action === "focus") {
    const active = document.activeElement;
    success = Boolean(active && createElementFingerprint(active) === targetFingerprint?.split("-")[0]);
    summary = success ? "The target received focus." : "The target did not retain focus.";
  } else if (step.action === "scroll") {
    success = hasObservableActionEffect(step, before, snapshot, diff, targetFingerprint);
    summary = success ? "The page or target scroll position changed." : "The requested scroll position did not move.";
  } else {
    success = hasObservableActionEffect(step, before, snapshot, diff, targetFingerprint);
    summary = success ? diff.summary.join("; ") : "The action produced no observable page change.";
  }
  const pageContentChanged = Boolean(success && step.action === "click" && targetBefore?.relation);
  return { success, summary, changes: diff.summary, diff, ...(pageContentChanged ? { pageContentChanged: true } : {}) };
}

async function executeStep(step: BrowserActionStep): Promise<{ action: string; ok: true }> {
  if (!["click", "fill", "select", "scroll", "focus", "submit"].includes(step.action)) throw new Error("Unsupported browser action.");
  if (step.action === "scroll") {
    const amount = Math.min(Math.max(step.amountPx ?? 600, 0), 2_000);
    const target = step.targetRef ? elementRefs.get(step.targetRef) : undefined;
    if (step.targetRef && (!(target instanceof HTMLElement) || !getScrollablePosition(target))) {
      throw new Error("The trusted scroll container is unavailable or no longer scrollable.");
    }
    const recipient = target instanceof HTMLElement ? target : window;
    if (step.direction === "top") {
      recipient.scrollTo({ top: 0, behavior: "smooth" });
      return { action: step.action, ok: true };
    }
    if (step.direction === "bottom") {
      recipient.scrollTo({
        top: target instanceof HTMLElement ? target.scrollHeight : document.documentElement.scrollHeight,
        behavior: "smooth",
      });
      return { action: step.action, ok: true };
    }
    const sign = step.direction === "up" || step.direction === "left" ? -1 : 1;
    recipient.scrollBy({ top: step.direction === "left" || step.direction === "right" ? 0 : amount * sign, left: step.direction === "left" || step.direction === "right" ? amount * sign : 0, behavior: "smooth" });
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
  await delay(120);
  if (!isTopLayerElement(element)) throw new Error("Target is covered by another page element.");
  await showAiPointer(element, `AI · ${step.action}`);
  if (step.action === "click") await simulateClick(element);
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

async function dismissElement(
  element: HTMLElement,
  snapshotRole?: string,
  recoveredOption?: RecoveredOption,
): Promise<void> {
  const role = snapshotRole || element.getAttribute("role") || inferRole(element);
  if (role === "combobox" || role === "listbox" || role === "menu" || role === "option") {
    if (element.getAttribute("aria-expanded") !== "true") {
      if (role === "combobox") throw new Error("Only an expanded combobox can be dismissed.");
      const selectedState = recoveredOption?.semanticElement.getAttribute("aria-selected")
        ?? element.getAttribute("aria-selected");
      if (role === "option" && selectedState !== "true") {
        throw new Error("Only a selected option can anchor popup dismissal.");
      }
    }
    if (await dismissPopupWithFallbacks({
      dispatchSyntheticEscape: () => dispatchEscapeKey(element),
      dispatchTrustedEscape: requestTrustedDismissEscape,
      clickSafeExterior: () => clickSafePopupExterior(
        element,
        (_target, point) => showAiPointerAtPoint(point.x, point.y, "AI · dismiss"),
        requestTrustedDismissClick,
        async () => {
          await delay(250);
          createPageSnapshot();
        },
      ),
      isOpen: () => isPopupDismissTargetOpen(element),
      afterKeyboardAttempt: async () => {
        await delay(250);
        createPageSnapshot();
      },
    })) return;
  } else {
    throw new Error("Popup housekeeping only supports an expanded combobox, visible listbox/menu, or selected option.");
  }
}

async function requestTrustedDismissEscape(): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: "page.dismiss.trusted-escape",
  }) as { ok?: boolean; error?: string };
  if (!response?.ok) {
    throw new Error(response?.error || "The browser could not perform the trusted popup dismissal Escape.");
  }
}

async function requestTrustedDismissClick(point: { x: number; y: number }): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: "page.dismiss.trusted-click",
    x: point.x,
    y: point.y,
  }) as { ok?: boolean; error?: string };
  if (!response?.ok) {
    throw new Error(response?.error || "The browser could not perform the trusted popup dismissal click.");
  }
}
