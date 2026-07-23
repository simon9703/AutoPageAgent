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
import { replayRecordedActions, setRecordingActive } from "./recording.js";
import { clearElementSelection, startElementSelection } from "./selection.js";
import { buildSelector, buildSimplifiedDom, cleanText, collectPageInfo, createElementFingerprint, delay, getAccessibleLabel, inferRole, isHiddenInput, isNearViewport, isSensitiveElement, isTopLayerElement, isVisible, round, setElementValue, shouldExposeValue, simulateClick } from "./dom.js";

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
    sendResponse(createPageSnapshot());
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



function createPageSnapshot(): PageSnapshot {
  currentSnapshotId = `${Date.now()}-${crypto.randomUUID()}`;
  currentSnapshotUrl = location.href;
  elementRefs.clear();
  const candidates = document.querySelectorAll(
    'button,a[href],input,textarea,select,[contenteditable="true"],[role="button"],[role="textbox"],[role="tab"],[role="checkbox"],[role="radio"]',
  );
  const elements: PageElementSnapshot[] = [];
  const fingerprintCounts = new Map<string, number>();
  for (const element of candidates) {
    if (!isVisible(element) || !isNearViewport(element, 700) || isHiddenInput(element) || elements.length >= 200) continue;
    const fingerprint = createElementFingerprint(element);
    const occurrence = (fingerprintCounts.get(fingerprint) ?? 0) + 1;
    fingerprintCounts.set(fingerprint, occurrence);
    const ref = `el-${fingerprint}-${occurrence}`;
    elementRefs.set(ref, element);
    const html = element as HTMLElement;
    const input = element as HTMLInputElement;
    const rect = element.getBoundingClientRect();
    elements.push({
      ref,
      tagName: element.tagName.toLowerCase(),
      role: element.getAttribute("role") ?? inferRole(element),
      label: getAccessibleLabel(element),
      text: cleanText(html.innerText || element.textContent || "", 300),
      selector: buildSelector(element),
      value: shouldExposeValue(input) ? cleanText(String(input.value ?? ""), 500) : undefined,
      href: element instanceof HTMLAnchorElement ? element.href : undefined,
      placeholder: input.placeholder || undefined,
      inputType: input.type || undefined,
      disabled: "disabled" in input && Boolean(input.disabled),
      sensitive: isSensitiveElement(element),
      contentEditable: html.isContentEditable,
      fingerprint: `${fingerprint}-${occurrence}`,
      inViewport: isNearViewport(element, 0),
      occluded: !isTopLayerElement(element),
      readonly: "readOnly" in input && Boolean(input.readOnly),
      ...(element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type) ? { checked: element.checked } : {}),
      ...(element.hasAttribute("aria-expanded") ? { expanded: element.getAttribute("aria-expanded") === "true" } : {}),
      ...(element.hasAttribute("aria-busy") ? { busy: element.getAttribute("aria-busy") === "true" } : {}),
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
    performance: collectPerformance(),
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
  try {
    const results = [await executeStep(step)];
    await waitForDomSettled();
    const after = createPageSnapshot();
    const diff = diffSnapshots(before, after);
    const verification = verifyAction(step, after, diff, targetFingerprint);
    return { ok: verification.success, results, snapshot: after, verification, ...(!verification.success ? { error: verification.summary } : {}) };
  } finally {
    hideAgentFrame(650);
  }
}

async function waitForDomSettled(maxWaitMs = 1_800, quietMs = 250): Promise<void> {
  const start = Date.now();
  let lastVersion = domVersion;
  let quietSince = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await delay(80);
    if (domVersion !== lastVersion) { lastVersion = domVersion; quietSince = Date.now(); }
    if (Date.now() - quietSince >= quietMs) return;
  }
}

export function diffSnapshots(before: PageSnapshot, after: PageSnapshot): PageSnapshotDiff {
  const beforeById = new Map(before.elements.map((element) => [element.fingerprint, element]));
  const afterById = new Map(after.elements.map((element) => [element.fingerprint, element]));
  const addedFingerprints = [...afterById.keys()].filter((key) => !beforeById.has(key));
  const removedFingerprints = [...beforeById.keys()].filter((key) => !afterById.has(key));
  const changedFingerprints = [...afterById.keys()].filter((key) => {
    const previous = beforeById.get(key);
    const next = afterById.get(key);
    return previous && next && JSON.stringify([previous.value, previous.disabled, previous.checked, previous.expanded, previous.busy, previous.occluded]) !== JSON.stringify([next.value, next.disabled, next.checked, next.expanded, next.busy, next.occluded]);
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

function verifyAction(step: BrowserActionStep, snapshot: PageSnapshot, diff: PageSnapshotDiff, targetFingerprint?: string): ActionVerification {
  const target = targetFingerprint ? snapshot.elements.find((element) => element.fingerprint === targetFingerprint) : undefined;
  let success = true;
  let summary = "Action dispatched and page observation completed.";
  if (step.action === "fill" || step.action === "select") {
    success = Boolean(target && target.value === (step.value ?? ""));
    summary = success ? "The target value matches the requested value." : "The target value did not match after the action.";
  } else if (step.action === "focus") {
    const active = document.activeElement;
    success = Boolean(active && createElementFingerprint(active) === targetFingerprint?.split("-")[0]);
    summary = success ? "The target received focus." : "The target did not retain focus.";
  } else if (step.action === "scroll") {
    summary = "The viewport position was observed after scrolling.";
  } else if (diff.summary.length) {
    summary = diff.summary.join("; ");
  }
  return { success, summary, changes: diff.summary, diff };
}

async function executeStep(step: BrowserActionStep): Promise<{ action: string; ok: true }> {
  if (!["click", "fill", "select", "scroll", "focus", "submit"].includes(step.action)) throw new Error("Unsupported browser action.");
  if (step.action === "scroll") {
    const amount = Math.min(Math.max(step.amountPx ?? 600, 0), 2_000);
    const sign = step.direction === "up" || step.direction === "left" ? -1 : 1;
    window.scrollBy({ top: step.direction === "left" || step.direction === "right" ? 0 : amount * sign, left: step.direction === "left" || step.direction === "right" ? amount * sign : 0, behavior: "smooth" });
    return { action: step.action, ok: true };
  }
  const element = step.targetRef ? elementRefs.get(step.targetRef) : undefined;
  if (!(element instanceof HTMLElement) || !isVisible(element)) throw new Error(`Target is unavailable: ${step.targetRef ?? "missing"}`);
  if (isSensitiveElement(element) && (step.action === "fill" || step.action === "select")) throw new Error("Sensitive fields cannot be filled by the agent.");
  if ("disabled" in element && Boolean((element as HTMLInputElement).disabled)) throw new Error("Target is disabled.");
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  await delay(220);
  if (!isTopLayerElement(element)) throw new Error("Target is covered by another page element.");
  await showAiPointer(element, `AI · ${step.action}`);
  if (step.action === "click") await simulateClick(element);
  if (step.action === "focus") element.focus();
  if (step.action === "submit") {
    const form = element.closest("form");
    if (!form) throw new Error("No form is associated with the submit target.");
    form.requestSubmit();
  }
  if (step.action === "fill") setElementValue(element, step.value ?? "");
  if (step.action === "select") setElementValue(element, step.value ?? "");
  return { action: step.action, ok: true };
}
