import type {
  BrowserActionPlan,
  BrowserActionStep,
  PageElementSnapshot,
  PageSnapshot,
  PerformanceSnapshot,
  InspectedElement,
  RecordedBrowserAction,
} from "@auto-page-agent/shared";

const elementRefs = new Map<string, Element>();
let currentSnapshotId = "";
let currentSnapshotUrl = "";
let selectionCleanup: (() => void) | null = null;
let recordingActive = false;
let scrollTimer: number | undefined;

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
  if (message?.type === "page.selection.start") {
    startElementSelection();
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
  for (const element of candidates) {
    if (!isVisible(element) || isHiddenInput(element) || elements.length >= 250) continue;
    const ref = `element-${elements.length + 1}`;
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
      viewportRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    });
  }

  return {
    snapshotId: currentSnapshotId,
    url: location.href,
    title: document.title,
    language: document.documentElement.lang || navigator.language,
    selectedText: cleanText(getSelection()?.toString() ?? "", 12_000),
    headings: Array.from(document.querySelectorAll("h1,h2,h3"))
      .filter(isVisible)
      .slice(0, 80)
      .map((heading) => ({ level: Number(heading.tagName[1]), text: cleanText(heading.textContent ?? "", 300) })),
    mainText: cleanText((document.querySelector("main,article") ?? document.body).textContent ?? "", 30_000),
    elements,
    performance: collectPerformance(),
  };
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

async function executePlan(plan: BrowserActionPlan) {
  if (plan.snapshotId !== currentSnapshotId) throw new Error("Page snapshot expired. Read the page again.");
  if (location.href !== currentSnapshotUrl) throw new Error("Page URL changed after the snapshot. Read the page again.");
  const results = [];
  for (const step of plan.steps) {
    results.push(await executeStep(step));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { ok: true, results };
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
  highlight(element);
  if (step.action === "click") element.click();
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
      highlight(element);
      if (step.action === "click") element.click();
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
  }
}

function recordAction(action: Omit<RecordedBrowserAction, "id" | "url" | "timestamp">) {
  const payload: RecordedBrowserAction = { ...action, id: "pending", url: location.href, timestamp: Date.now() };
  void chrome.runtime.sendMessage({ type: "page.recording.action", action: payload }).catch(() => undefined);
}

function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function startElementSelection() {
  selectionCleanup?.();
  let hovered: HTMLElement | null = null;
  let previousOutline = "";
  const restore = () => {
    if (hovered) hovered.style.outline = previousOutline;
    hovered = null;
  };
  const onMove = (event: MouseEvent) => {
    const next = event.target instanceof HTMLElement ? event.target : null;
    if (!next || next === hovered) return;
    restore();
    hovered = next;
    previousOutline = next.style.outline;
    next.style.outline = "3px solid #7c5cff";
  };
  const cleanup = () => {
    restore();
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    selectionCleanup = null;
  };
  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const selected = inspectElement(event.target);
    cleanup();
    void chrome.runtime.sendMessage({ type: "page.element.selected", element: selected, pageUrl: location.href });
  };
  const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") cleanup(); };
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

function isHiddenInput(element: Element): boolean {
  return element instanceof HTMLInputElement && element.type === "hidden";
}

function isSensitiveElement(element: Element): boolean {
  if (!(element instanceof HTMLInputElement)) return false;
  return ["password", "file"].includes(element.type) || /password|secret|token|otp|card|cvv|credential/iu.test(`${element.name} ${element.autocomplete}`);
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

function highlight(element: HTMLElement) {
  const previous = element.style.outline;
  element.style.outline = "3px solid #7c5cff";
  setTimeout(() => { element.style.outline = previous; }, 1_500);
}

function cleanText(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
