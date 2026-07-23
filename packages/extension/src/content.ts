import type {
  ActionExecutionResult,
  ActionVerification,
  BrowserActionPlan,
  BrowserActionStep,
  PageElementSnapshot,
  PageSnapshot,
  PerformanceSnapshot,
  InspectedElement,
  ElementSelectionGeometry,
  RecordedBrowserAction,
  PageSnapshotDiff,
} from "@auto-page-agent/shared";
import {
  clearSelectedTarget,
  createPickerVisuals,
  setSelectedTarget,
} from "./content/agent-visuals.js";

const elementRefs = new Map<string, Element>();
let currentSnapshotId = "";
let currentSnapshotUrl = "";
let currentSnapshot: PageSnapshot | null = null;
let selectionCleanup: (() => void) | null = null;
let recordingActive = false;
let scrollTimer: number | undefined;
let aiPointer: HTMLElement | null = null;
let actionOutline: HTMLElement | null = null;
let agentFrame: HTMLElement | null = null;
let persistentAgentActivity = false;
let agentFrameHideTimer: number | undefined;
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
    persistentAgentActivity = Boolean(message.active);
    if (persistentAgentActivity) showAgentFrame();
    else hideAgentFrame();
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "page.selection.start") {
    startElementSelection(message.mode === "image" ? "image" : "element");
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "page.selection.clear") {
    selectionCleanup?.();
    clearSelectedTarget();
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "page.performance") {
    sendResponse(collectPerformance());
    return false;
  }
  if (message?.type === "page.recording.start") {
    recordingActive = true;
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "page.recording.stop") {
    recordingActive = false;
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

document.addEventListener("click", (event) => {
  if (!recordingActive || !(event.target instanceof Element)) return;
  const target = event.target.closest("button,a[href],input,[role='button'],[role='tab'],[role='checkbox'],[role='radio']");
  if (!target) return;
  recordAction({ action: "click", selector: buildSelector(target), label: getAccessibleLabel(target) || cleanText(target.textContent || "", 160), sensitive: isSensitiveElement(target) });
}, true);

document.addEventListener("change", (event) => {
  if (!recordingActive || !(event.target instanceof HTMLElement)) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
  const sensitive = isSensitiveElement(target);
  recordAction({
    action: target instanceof HTMLSelectElement ? "select" : "fill",
    selector: buildSelector(target),
    label: getAccessibleLabel(target) || target.getAttribute("name") || target.getAttribute("placeholder") || undefined,
    value: sensitive ? undefined : target.value,
    sensitive,
  });
}, true);

document.addEventListener("submit", (event) => {
  if (!recordingActive || !(event.target instanceof HTMLFormElement)) return;
  recordAction({ action: "submit", selector: buildSelector(event.target), label: event.target.getAttribute("name") || "form", sensitive: false });
}, true);

window.addEventListener("scroll", () => {
  if (!recordingActive) return;
  window.clearTimeout(scrollTimer);
  scrollTimer = window.setTimeout(() => recordAction({ action: "scroll", sensitive: false, scrollX: window.scrollX, scrollY: window.scrollY }), 400);
}, { passive: true });

void chrome.runtime.sendMessage({ type: "page.recording.ready" }).catch(() => undefined);

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
  const simplifiedDom = buildSimplifiedDom(elements);
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
    if (!persistentAgentActivity) hideAgentFrame(650);
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

async function replayRecordedActions(actions: RecordedBrowserAction[]) {
  const wasRecording = recordingActive;
  recordingActive = false;
  showAgentFrame();
  const results: Array<{ action: string; ok: true }> = [];
  try {
    for (const step of actions) {
      if (step.sensitive) throw new Error(`Step “${step.label || step.action}” targets a sensitive field and requires manual input.`);
      if (step.action === "scroll") {
        window.scrollTo({ left: step.scrollX ?? 0, top: step.scrollY ?? 0, behavior: "smooth" });
        results.push({ action: step.action, ok: true });
        await delay(350);
        continue;
      }
      if (!step.selector) throw new Error(`Recorded ${step.action} step has no selector.`);
      let element: Element | null;
      try { element = document.querySelector(step.selector); }
      catch { throw new Error(`Recorded selector is invalid: ${step.selector}`); }
      if (!(element instanceof HTMLElement) || !isVisible(element)) throw new Error(`Recorded target is unavailable: ${step.label || step.selector}`);
      if (isSensitiveElement(element)) throw new Error("Sensitive fields cannot be replayed.");
      element.scrollIntoView({ block: "center", behavior: "smooth" });
      await showAiPointer(element, `AI · ${step.action}`);
      if (step.action === "click") await simulateClick(element);
      if (step.action === "fill" || step.action === "select") setElementValue(element, step.value ?? "");
      if (step.action === "submit") {
        const form = element instanceof HTMLFormElement ? element : element.closest("form");
        if (!form) throw new Error("Recorded submit target has no form.");
        form.requestSubmit();
      }
      results.push({ action: step.action, ok: true });
      await delay(350);
    }
    return { ok: true, results };
  } finally {
    recordingActive = wasRecording;
    if (!persistentAgentActivity) hideAgentFrame(650);
  }
}

function recordAction(action: Omit<RecordedBrowserAction, "id" | "url" | "timestamp">) {
  const payload: RecordedBrowserAction = { ...action, id: "pending", url: location.href, timestamp: Date.now() };
  void chrome.runtime.sendMessage({ type: "page.recording.action", action: payload }).catch(() => undefined);
}

function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function startElementSelection(mode: "element" | "image") {
  selectionCleanup?.();
  ensureAgentStyles();
  document.documentElement.classList.add("auto-page-agent-picking");
  const visuals = createPickerVisuals();
  const notice = document.createElement("div");
  notice.dataset.autoPageAgentOverlay = "true";
  notice.className = "auto-page-agent-notice";
  notice.textContent = mode === "image" ? "AI · Select an element to capture · Esc to cancel" : "AI · Select an element · Esc to cancel";
  document.documentElement.append(notice);
  let hovered: Element | null = null;
  const restore = () => {
    hovered = null;
    visuals.clearTarget();
  };
  const onMove = (event: MouseEvent) => {
    visuals.movePointer(event.clientX, event.clientY);
    const raw = event.target instanceof Element ? event.target : null;
    const next = mode === "image" ? findImageTarget(raw) ?? raw : raw;
    if (!next || next === hovered) return;
    restore();
    hovered = next;
    visuals.showTarget(next);
  };
  const cleanup = () => {
    restore();
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    document.documentElement.classList.remove("auto-page-agent-picking");
    notice.remove();
    visuals.destroy();
    selectionCleanup = null;
  };
  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    const target = mode === "image"
      ? findImageTarget(event.target) ?? event.target
      : event.target;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (mode === "image" && isSensitiveCaptureTarget(target)) {
      cleanup();
      void chrome.runtime.sendMessage({ type: "page.selection.cancelled", reason: "Sensitive fields cannot be captured." }).catch(() => undefined);
      return;
    }
    const selected = inspectElement(target);
    const rect = target.getBoundingClientRect();
    const geometry: ElementSelectionGeometry = {
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
    const pageUrl = location.href;
    cleanup();
    void chrome.runtime.sendMessage({ type: "page.element.selected", mode, element: selected, geometry, pageUrl })
      .then((response: { ok?: boolean }) => {
        if (response?.ok && location.href === pageUrl && target.isConnected) setSelectedTarget(target);
      })
      .catch(() => undefined);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    cleanup();
    void chrome.runtime.sendMessage({ type: "page.selection.cancelled" }).catch(() => undefined);
  };
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  selectionCleanup = cleanup;
}

function inspectElement(element: Element): InspectedElement {
  const attributes = Object.fromEntries(Array.from(element.attributes)
    .filter((attribute) => /^(?:id|name|role|type|placeholder|data-[\w-]+|aria-[\w-]+)$/u.test(attribute.name))
    .slice(0, 30)
    .map((attribute) => [attribute.name, cleanText(attribute.value, 500)]));
  const html = element as HTMLElement;
  const input = element as HTMLInputElement;
  const source = {
    component: findMetadata(element, "data-component"),
    file: findMetadata(element, "data-source"),
    repository: findMetadata(element, "data-repo"),
    // TODO(i18n): Read data-i18n-key here when translation analysis is enabled.
  };
  return {
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute("role") ?? inferRole(element),
    label: getAccessibleLabel(element),
    text: cleanText(html.innerText || element.textContent || "", 1_000),
    placeholder: input.placeholder || undefined,
    inputType: input.type || undefined,
    attributes,
    nearbyText: cleanText(element.parentElement?.innerText || "", 2_000),
    selector: buildSelector(element),
    image: getImageInfo(element),
    source: Object.values(source).some(Boolean) ? source : undefined,
  };
}

function findMetadata(element: Element, name: string): string | undefined {
  return element.closest(`[${name}]`)?.getAttribute(name) || undefined;
}

function setElementValue(element: HTMLElement, value: string) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  } else if (element instanceof HTMLSelectElement) {
    element.value = value;
  } else if (element.isContentEditable) {
    element.textContent = value;
  } else {
    throw new Error("Target does not accept text.");
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function isNearViewport(element: Element, expansion: number): boolean {
  const rect = element.getBoundingClientRect();
  return rect.bottom >= -expansion && rect.top <= innerHeight + expansion && rect.right >= -expansion && rect.left <= innerWidth + expansion;
}

function isTopLayerElement(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) return true;
  const x = Math.min(Math.max(rect.left + rect.width / 2, 0), innerWidth - 1);
  const y = Math.min(Math.max(rect.top + rect.height / 2, 0), innerHeight - 1);
  const top = document.elementFromPoint(x, y);
  return !top || top === element || element.contains(top) || top.contains(element);
}

function isHiddenInput(element: Element): boolean {
  return element instanceof HTMLInputElement && element.type === "hidden";
}

function isSensitiveElement(element: Element): boolean {
  if (!(element instanceof HTMLInputElement)) return false;
  return ["password", "file"].includes(element.type) || /password|secret|token|otp|card|cvv|credential/iu.test(`${element.name} ${element.autocomplete}`);
}

function isSensitiveCaptureTarget(element: Element): boolean {
  const candidates = [element, ...Array.from(element.querySelectorAll("input,textarea,select"))];
  return candidates.some((candidate) => {
    if (isSensitiveElement(candidate)) return true;
    const attributes = [
      candidate.getAttribute("type"),
      candidate.getAttribute("name"),
      candidate.getAttribute("id"),
      candidate.getAttribute("autocomplete"),
      candidate.getAttribute("placeholder"),
      candidate.getAttribute("aria-label"),
    ].filter(Boolean).join(" ");
    return /password|passcode|secret|token|otp|one.?time|payment|card|cvv|cvc|iban|credential|file/iu.test(attributes);
  });
}

function shouldExposeValue(element: Element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) && !isSensitiveElement(element);
}

function getAccessibleLabel(element: Element): string {
  const labelledBy = element.getAttribute("aria-labelledby");
  const labelledText = labelledBy ? labelledBy.split(/\s+/u).map((id) => document.getElementById(id)?.textContent ?? "").join(" ") : "";
  const inputLabel = element instanceof HTMLElement && element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent : "";
  return cleanText(element.getAttribute("aria-label") || labelledText || inputLabel || element.getAttribute("title") || "", 300);
}

function inferRole(element: Element): string {
  if (element instanceof HTMLButtonElement) return "button";
  if (element instanceof HTMLAnchorElement) return "link";
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return "textbox";
  if (element instanceof HTMLSelectElement) return "combobox";
  return "";
}

function buildSelector(element: Element): string {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const testId = element.getAttribute("data-testid");
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
  const path: string[] = [];
  let current: Element | null = element;
  while (current && path.length < 4) {
    const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((item) => item.tagName === current?.tagName) : [];
    const suffix = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
    path.unshift(`${current.tagName.toLowerCase()}${suffix}`);
    current = current.parentElement;
  }
  return path.join(" > ");
}

function createElementFingerprint(element: Element): string {
  const raw = [
    element.tagName.toLowerCase(),
    element.getAttribute("role") || inferRole(element),
    element.id,
    element.getAttribute("name"),
    element.getAttribute("data-testid"),
    element.getAttribute("aria-label") || getAccessibleLabel(element),
    element.getAttribute("placeholder"),
    cleanText(element.textContent || "", 80),
  ].filter(Boolean).join("|").toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) hash = Math.imul(hash ^ raw.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

function buildSimplifiedDom(elements: PageElementSnapshot[]): string {
  if (!elements.length) return "<EMPTY>";
  const groups = new Map<string, PageElementSnapshot[]>();
  for (const element of elements) {
    const domElement = elementRefs.get(element.ref);
    const landmark = domElement?.closest("main,nav,header,footer,aside,form,dialog,[role='dialog'],[role='navigation']");
    const name = landmark?.getAttribute("role") || landmark?.tagName.toLowerCase() || "page";
    const group = groups.get(name) ?? [];
    group.push(element);
    groups.set(name, group);
  }
  return Array.from(groups, ([name, group]) => [
    `<${name} data-ai-group=\"${name}\">`,
    ...group.map((element, index) => `  ${simplifyElement(element, index + 1)}`),
    `</${name}>`,
  ].join("\n")).join("\n");
}

function simplifyElement(element: PageElementSnapshot, index: number): string {
  const attributes = [
    `data-ai-ref="${element.ref}"`,
    element.role ? `role="${escapeDomText(element.role)}"` : "",
    element.label ? `aria-label="${escapeDomText(element.label)}"` : "",
    element.placeholder ? `placeholder="${escapeDomText(element.placeholder)}"` : "",
    element.inputType ? `type="${escapeDomText(element.inputType)}"` : "",
    element.disabled ? "disabled" : "",
    element.readonly ? "readonly" : "",
    element.occluded ? 'data-occluded="true"' : "",
    !element.inViewport ? 'data-offscreen="true"' : "",
    typeof element.checked === "boolean" ? `aria-checked="${element.checked}"` : "",
    typeof element.expanded === "boolean" ? `aria-expanded="${element.expanded}"` : "",
    element.busy ? 'aria-busy="true"' : "",
    element.sensitive ? 'data-sensitive="true"' : "",
  ].filter(Boolean).join(" ");
  const text = escapeDomText(cleanText(element.text || element.value || "", 180));
  return `[${index}]<${element.tagName}${attributes ? ` ${attributes}` : ""}>${text}</${element.tagName}>`;
}

function collectPageInfo() {
  const pageWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth || 0);
  const pageHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight || 0);
  return { viewportWidth: innerWidth, viewportHeight: innerHeight, pageWidth, pageHeight, scrollX, scrollY, pixelsAbove: scrollY, pixelsBelow: Math.max(0, pageHeight - (innerHeight + scrollY)) };
}

function getImageInfo(element: Element): InspectedElement["image"] {
  const image = element instanceof HTMLImageElement ? element : element.querySelector("img");
  if (image instanceof HTMLImageElement && image.currentSrc) {
    const rect = image.getBoundingClientRect();
    return { src: image.currentSrc, alt: cleanText(image.alt || getAccessibleLabel(image), 500), width: Math.round(rect.width), height: Math.round(rect.height) };
  }
  if (!(element instanceof HTMLElement)) return undefined;
  const src = /^url\(["']?(.*?)["']?\)$/u.exec(getComputedStyle(element).backgroundImage)?.[1];
  if (!src) return undefined;
  const rect = element.getBoundingClientRect();
  try { return { src: new URL(src, location.href).href, alt: getAccessibleLabel(element), width: Math.round(rect.width), height: Math.round(rect.height) }; }
  catch { return undefined; }
}

function findImageTarget(element: Element | null): Element | null {
  if (!element) return null;
  const image = element.closest("img,[role='img']") ?? element.querySelector("img,[role='img']");
  if (image) return image;
  let current: Element | null = element;
  while (current && current !== document.body) {
    if (getImageInfo(current)) return current;
    current = current.parentElement;
  }
  return null;
}

async function simulateClick(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const options = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0 };
  element.dispatchEvent(new PointerEvent("pointerover", { ...options, pointerType: "mouse" }));
  element.dispatchEvent(new MouseEvent("mouseover", options));
  element.dispatchEvent(new PointerEvent("pointerdown", { ...options, pointerType: "mouse" }));
  element.dispatchEvent(new MouseEvent("mousedown", options));
  element.focus({ preventScroll: true });
  element.dispatchEvent(new PointerEvent("pointerup", { ...options, pointerType: "mouse" }));
  element.dispatchEvent(new MouseEvent("mouseup", options));
  element.click();
  await delay(180);
}

async function showAiPointer(element: HTMLElement, label: string) {
  ensureAgentStyles();
  if (!aiPointer) {
    aiPointer = createPointer("auto-page-agent-pointer");
  }
  actionOutline ??= createElementOutline("action");
  const rect = element.getBoundingClientRect();
  aiPointer.querySelector<HTMLElement>(".auto-page-agent-pointer-label")!.textContent = label;
  positionElementOutline(actionOutline, element, label);
  actionOutline.classList.add("visible");
  aiPointer.classList.add("visible");
  positionPointer(aiPointer, rect.left + rect.width / 2, rect.top + rect.height / 2);
  await delay(520);
  aiPointer.classList.add("clicking");
  actionOutline.classList.add("acting");
  await delay(180);
  aiPointer.classList.remove("clicking");
  actionOutline.classList.remove("acting");
  setTimeout(() => {
    aiPointer?.classList.remove("visible");
    actionOutline?.classList.remove("visible");
  }, 650);
}

function createPointer(className: string): HTMLElement {
  const pointer = document.createElement("div");
  pointer.dataset.autoPageAgentOverlay = "true";
  pointer.className = className;
  pointer.innerHTML = `
    <span class="auto-page-agent-pointer-pulse"></span>
    <svg class="auto-page-agent-pointer-arrow" viewBox="0 0 38 46" aria-hidden="true">
      <path d="M3 2.8v34.4l9.2-8.2 7.2 14 7.4-3.8-7.1-13.7 12.3-1.2L3 2.8Z" />
    </svg>
    <span class="auto-page-agent-pointer-label"></span>
  `;
  document.documentElement.append(pointer);
  return pointer;
}

function positionPointer(pointer: HTMLElement | null, x: number, y: number) {
  if (!pointer) return;
  pointer.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
  pointer.classList.add("visible");
}

function createElementOutline(kind: "picker" | "selected" | "action"): HTMLElement {
  const outline = document.createElement("div");
  outline.dataset.autoPageAgentOverlay = "true";
  outline.className = `auto-page-agent-element-outline ${kind}`;
  outline.innerHTML = `
    <span class="auto-page-agent-corner top-left"></span>
    <span class="auto-page-agent-corner top-right"></span>
    <span class="auto-page-agent-corner bottom-left"></span>
    <span class="auto-page-agent-corner bottom-right"></span>
    <span class="auto-page-agent-outline-label"></span>
  `;
  document.documentElement.append(outline);
  return outline;
}

function positionElementOutline(outline: HTMLElement | null, target: Element, label: string) {
  if (!outline) return;
  const rect = target.getBoundingClientRect();
  outline.classList.toggle("offscreen", rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth);
  const left = Math.max(2, rect.left);
  const top = Math.max(2, rect.top);
  const right = Math.min(innerWidth - 2, rect.right);
  const bottom = Math.min(innerHeight - 2, rect.bottom);
  outline.style.transform = `translate3d(${Math.round(left)}px,${Math.round(top)}px,0)`;
  outline.style.width = `${Math.max(0, Math.round(right - left))}px`;
  outline.style.height = `${Math.max(0, Math.round(bottom - top))}px`;
  outline.classList.toggle("label-below", top < 34);
  outline.querySelector<HTMLElement>(".auto-page-agent-outline-label")!.textContent = label;
}

function describeElement(element: Element): string {
  const role = element.getAttribute("role");
  const identity = element.id ? `#${element.id}` : element.getAttribute("aria-label");
  return [element.tagName.toLowerCase(), role, identity].filter(Boolean).join(" · ");
}

function showAgentFrame() {
  ensureAgentStyles();
  window.clearTimeout(agentFrameHideTimer);
  agentFrameHideTimer = undefined;
  if (!agentFrame) {
    agentFrame = document.createElement("div");
    agentFrame.dataset.autoPageAgentOverlay = "true";
    agentFrame.className = "auto-page-agent-viewport-frame";
    agentFrame.innerHTML = '<span class="auto-page-agent-frame-status"><i></i> AI is operating</span>';
    document.documentElement.append(agentFrame);
  }
  requestAnimationFrame(() => agentFrame?.classList.add("visible"));
}

function hideAgentFrame(delayMs = 0) {
  window.clearTimeout(agentFrameHideTimer);
  agentFrameHideTimer = window.setTimeout(() => {
    if (persistentAgentActivity) return;
    agentFrame?.classList.remove("visible");
  }, delayMs);
}

function ensureAgentStyles() {
  if (document.querySelector("style[data-auto-page-agent-overlay]")) return;
  const style = document.createElement("style");
  style.dataset.autoPageAgentOverlay = "true";
  style.textContent = `
    html.auto-page-agent-picking, html.auto-page-agent-picking * { cursor: none !important; }
    .auto-page-agent-notice { position: fixed; z-index: 2147483647; top: 18px; left: 50%; transform: translateX(-50%); padding: 9px 15px; border: 1px solid #ffffff38; border-radius: 999px; color: white; background: linear-gradient(135deg,#5b31d2eF,#8b5cf6eF 55%,#2563ebeF); backdrop-filter: blur(14px); box-shadow: 0 10px 35px #4c1d9560, inset 0 1px #ffffff40; font: 650 12px/1.2 system-ui,-apple-system,sans-serif; letter-spacing: .01em; pointer-events: none; }
    .auto-page-agent-pointer, .auto-page-agent-picker-pointer { position: fixed; z-index: 2147483647; left: 0; top: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; will-change: transform; }
    .auto-page-agent-pointer { transition: transform .52s cubic-bezier(.16,1,.3,1), opacity .16s ease; }
    .auto-page-agent-picker-pointer { transition: opacity .1s ease; }
    .auto-page-agent-pointer.visible, .auto-page-agent-picker-pointer.visible { opacity: 1; }
    .auto-page-agent-pointer-arrow { position: absolute; left: -4px; top: -4px; width: 38px; height: 46px; overflow: visible; filter: drop-shadow(0 5px 8px #312e8160); transform-origin: 5px 5px; }
    .auto-page-agent-pointer-arrow path { fill: white; stroke: #7657f5; stroke-width: 3.4; stroke-linejoin: round; }
    .auto-page-agent-picker-pointer .auto-page-agent-pointer-arrow { width: 32px; height: 39px; }
    .auto-page-agent-pointer-pulse { position: absolute; left: -12px; top: -12px; width: 24px; height: 24px; border: 2px solid #38bdf8; border-radius: 50%; opacity: 0; transform: scale(.25); }
    .auto-page-agent-pointer.clicking .auto-page-agent-pointer-arrow { animation: auto-page-agent-pointer-press .18s ease; }
    .auto-page-agent-pointer.clicking .auto-page-agent-pointer-pulse { animation: auto-page-agent-click-ripple .55s ease-out; }
    .auto-page-agent-pointer-label { position: absolute; left: 28px; top: 31px; width: max-content; max-width: 190px; padding: 5px 9px; border: 1px solid #ffffff38; border-radius: 8px; color: white; background: linear-gradient(135deg,#5b31d2,#7657f5); box-shadow: 0 7px 20px #4c1d9550; font: 650 10px/1.2 system-ui,-apple-system,sans-serif; letter-spacing: .015em; }
    .auto-page-agent-picker-pointer .auto-page-agent-pointer-label { display: none; }
    .auto-page-agent-element-outline { position: fixed; z-index: 2147483645; left: 0; top: 0; box-sizing: border-box; opacity: 0; pointer-events: none; border: 1.5px solid #8b5cf6; border-radius: 5px; background: #8b5cf60a; box-shadow: 0 0 0 1px #ffffffb0 inset, 0 0 0 3px #8b5cf61c, 0 8px 30px #4c1d9524; transition: transform .08s ease-out,width .08s ease-out,height .08s ease-out,opacity .1s ease; }
    .auto-page-agent-element-outline.visible { opacity: 1; }
    .auto-page-agent-element-outline.offscreen { opacity: 0; }
    .auto-page-agent-element-outline.selected { border-color: #6d5dfc; background: linear-gradient(135deg,#7c5cff12,#38bdf80d); box-shadow: 0 0 0 1px #ffffffd0 inset,0 0 0 4px #7c5cff22,0 10px 34px #4338ca2c; }
    .auto-page-agent-element-outline.action { border-color: #22d3ee; background: #22d3ee0d; box-shadow: 0 0 0 1px #ffffffd0 inset,0 0 0 5px #22d3ee25,0 0 26px #7c3aed48; transition: transform .18s ease-out,width .18s ease-out,height .18s ease-out,opacity .12s ease; }
    .auto-page-agent-element-outline.action.acting { animation: auto-page-agent-target-pop .45s ease-out; }
    .auto-page-agent-corner { position: absolute; width: 10px; height: 10px; border-color: #7657f5; }
    .auto-page-agent-corner.top-left { left: -3px; top: -3px; border-left: 3px solid; border-top: 3px solid; border-radius: 4px 0 0; }
    .auto-page-agent-corner.top-right { right: -3px; top: -3px; border-right: 3px solid; border-top: 3px solid; border-radius: 0 4px 0 0; }
    .auto-page-agent-corner.bottom-left { left: -3px; bottom: -3px; border-left: 3px solid; border-bottom: 3px solid; border-radius: 0 0 0 4px; }
    .auto-page-agent-corner.bottom-right { right: -3px; bottom: -3px; border-right: 3px solid; border-bottom: 3px solid; border-radius: 0 0 4px; }
    .auto-page-agent-element-outline.action .auto-page-agent-corner { border-color: #22d3ee; }
    .auto-page-agent-outline-label { position: absolute; left: -1px; bottom: calc(100% + 7px); max-width: min(280px,70vw); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 4px 8px; border: 1px solid #ffffff40; border-radius: 7px; color: white; background: linear-gradient(135deg,#5b31d2,#7657f5); box-shadow: 0 5px 16px #4c1d9545; font: 650 10px/1.25 system-ui,-apple-system,sans-serif; }
    .auto-page-agent-element-outline.label-below .auto-page-agent-outline-label { top: calc(100% + 7px); bottom: auto; }
    .auto-page-agent-element-outline.action .auto-page-agent-outline-label { background: linear-gradient(135deg,#4338ca,#0891b2); }
    .auto-page-agent-viewport-frame { position: fixed; z-index: 2147483643; inset: 0; box-sizing: border-box; opacity: 0; pointer-events: none; border: 3px solid transparent; border-radius: 10px; background: linear-gradient(transparent,transparent) padding-box,linear-gradient(115deg,#22d3ee,#6366f1,#a855f7,#ec4899,#22d3ee) border-box; background-size: 100% 100%,300% 300%; box-shadow: inset 0 0 34px #6366f120,0 0 24px #7c3aed38; transition: opacity .28s ease; animation: auto-page-agent-frame-flow 4s linear infinite; }
    .auto-page-agent-viewport-frame.visible { opacity: 1; }
    .auto-page-agent-frame-status { position: absolute; right: 15px; bottom: 14px; display: flex; align-items: center; gap: 7px; padding: 6px 10px; border: 1px solid #ffffff3d; border-radius: 999px; color: white; background: #17132bdc; backdrop-filter: blur(12px); box-shadow: 0 8px 24px #312e8150; font: 650 10px/1 system-ui,-apple-system,sans-serif; letter-spacing: .02em; }
    .auto-page-agent-frame-status i { width: 7px; height: 7px; border-radius: 50%; background: #67e8f9; box-shadow: 0 0 0 4px #22d3ee25,0 0 12px #22d3ee; animation: auto-page-agent-status-pulse 1.4s ease-in-out infinite; }
    @keyframes auto-page-agent-frame-flow { to { background-position: 0 0,300% 50%; } }
    @keyframes auto-page-agent-status-pulse { 50% { opacity: .45; transform: scale(.72); } }
    @keyframes auto-page-agent-pointer-press { 50% { transform: scale(.82) rotate(-3deg); } }
    @keyframes auto-page-agent-click-ripple { 0% { opacity: .95; transform: scale(.25); } 100% { opacity: 0; transform: scale(2.25); } }
    @keyframes auto-page-agent-target-pop { 50% { box-shadow: 0 0 0 9px #22d3ee28,0 0 40px #7c3aed5c; } }
    @media (prefers-reduced-motion: reduce) { .auto-page-agent-pointer,.auto-page-agent-element-outline,.auto-page-agent-viewport-frame { transition-duration: .01ms; animation: none; } }
  `;
  document.documentElement.append(style);
}

function escapeDomText(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

function cleanText(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
