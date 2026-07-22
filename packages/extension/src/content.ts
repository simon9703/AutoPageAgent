import type {
  BrowserActionPlan,
  BrowserActionStep,
  PageElementSnapshot,
  PageSnapshot,
  PerformanceSnapshot,
} from "@auto-page-agent/shared";

const elementRefs = new Map<string, Element>();
let currentSnapshotId = "";

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
  return false;
});

function createPageSnapshot(): PageSnapshot {
  currentSnapshotId = `${Date.now()}-${crypto.randomUUID()}`;
  elementRefs.clear();
  const candidates = document.querySelectorAll(
    'button,a[href],input,textarea,select,[contenteditable="true"],[role="button"],[role="textbox"],[role="tab"],[role="checkbox"],[role="radio"]',
  );
  const elements: PageElementSnapshot[] = [];
  for (const element of candidates) {
    if (!isVisible(element) || elements.length >= 250) continue;
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
      value: "value" in input ? cleanText(String(input.value ?? ""), 500) : undefined,
      href: element instanceof HTMLAnchorElement ? element.href : undefined,
      placeholder: input.placeholder || undefined,
      inputType: input.type || undefined,
      disabled: "disabled" in input && Boolean(input.disabled),
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
    summary: {
      requestCount: resources.length,
      totalTransferSize: resources.reduce((total, resource) => total + resource.transferSize, 0),
      slowRequestCount: resources.filter((resource) => resource.duration > 1_000).length,
    },
  };
}

async function executePlan(plan: BrowserActionPlan) {
  if (plan.snapshotId !== currentSnapshotId) throw new Error("Page snapshot expired. Read the page again.");
  const results = [];
  for (const step of plan.steps) {
    results.push(await executeStep(step));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { ok: true, results };
}

async function executeStep(step: BrowserActionStep): Promise<{ action: string; ok: true }> {
  if (step.action === "scroll") {
    const amount = Math.min(Math.max(step.amountPx ?? 600, 0), 2_000);
    const sign = step.direction === "up" || step.direction === "left" ? -1 : 1;
    window.scrollBy({ top: step.direction === "left" || step.direction === "right" ? 0 : amount * sign, left: step.direction === "left" || step.direction === "right" ? amount * sign : 0, behavior: "smooth" });
    return { action: step.action, ok: true };
  }
  const element = step.targetRef ? elementRefs.get(step.targetRef) : undefined;
  if (!(element instanceof HTMLElement) || !isVisible(element)) throw new Error(`Target is unavailable: ${step.targetRef ?? "missing"}`);
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  highlight(element);
  if (step.action === "click") element.click();
  if (step.action === "focus") element.focus();
  if (step.action === "submit") element.closest("form")?.requestSubmit();
  if (step.action === "fill") setElementValue(element, step.value ?? "");
  if (step.action === "select") setElementValue(element, step.value ?? "");
  return { action: step.action, ok: true };
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

function getAccessibleLabel(element: Element): string {
  const labelledBy = element.getAttribute("aria-labelledby");
  const labelledText = labelledBy ? document.getElementById(labelledBy)?.textContent : "";
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
