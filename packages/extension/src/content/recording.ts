import type { RecordedBrowserAction } from "@auto-page-agent/shared";
import { hideAgentFrame, showAgentFrame, showAiPointer } from "./agent-activity.js";
import { buildSelector, cleanText, delay, getAccessibleLabel, isSensitiveElement, isVisible, setElementValue, simulateClick } from "./dom.js";

let recordingActive = false;
const inputTimers = new Map<Element, number>();
const scrollTimers = new Map<EventTarget, number>();

export function setRecordingActive(active: boolean) {
  recordingActive = active;
  if (!active) {
    for (const timer of inputTimers.values()) window.clearTimeout(timer);
    for (const timer of scrollTimers.values()) window.clearTimeout(timer);
    inputTimers.clear();
    scrollTimers.clear();
  }
}

document.addEventListener("click", (event) => {
  if (!recordingActive || !(event.target instanceof Element)) return;
  const target = event.target.closest("button,a[href],[role='button'],[role='tab']");
  if (!target) return;
  recordAction({ action: "click", selector: buildSelector(target), label: getAccessibleLabel(target) || cleanText(target.textContent || "", 160), sensitive: isSensitiveElement(target) });
}, true);

document.addEventListener("input", (event) => {
  if (!recordingActive || !(event.target instanceof HTMLElement)) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable)) return;
  window.clearTimeout(inputTimers.get(target));
  inputTimers.set(target, window.setTimeout(() => {
    inputTimers.delete(target);
    recordFormValue(target);
  }, 350));
}, true);

document.addEventListener("change", (event) => {
  if (!recordingActive || !(event.target instanceof HTMLElement)) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable)) return;
  window.clearTimeout(inputTimers.get(target));
  inputTimers.delete(target);
  recordFormValue(target);
}, true);

document.addEventListener("submit", (event) => {
  if (!recordingActive || !(event.target instanceof HTMLFormElement)) return;
  recordAction({ action: "submit", selector: buildSelector(event.target), label: event.target.getAttribute("name") || "form", sensitive: false });
}, true);

document.addEventListener("scroll", (event) => {
  if (!recordingActive) return;
  const source = event.target ?? document;
  window.clearTimeout(scrollTimers.get(source));
  scrollTimers.set(source, window.setTimeout(() => {
    scrollTimers.delete(source);
    const target = source instanceof Element ? source : null;
    recordAction({
      action: "scroll",
      sensitive: false,
      ...(target ? { selector: buildSelector(target), label: getAccessibleLabel(target) || target.getAttribute("aria-label") || "scroll area", scrollX: target.scrollLeft, scrollY: target.scrollTop } : { scrollX: window.scrollX, scrollY: window.scrollY }),
    });
  }, 400));
}, { passive: true, capture: true });

void chrome.runtime.sendMessage({ type: "page.recording.ready" }).catch(() => undefined);

export async function replayRecordedActions(actions: RecordedBrowserAction[]) {
  const wasRecording = recordingActive;
  recordingActive = false;
  showAgentFrame();
  const results: Array<{ action: string; ok: true }> = [];
  try {
    for (const step of actions) {
      if (step.sensitive) throw new Error(`Step “${step.label || step.action}” targets a sensitive field and requires manual input.`);
      if (step.action === "scroll") {
        if (step.selector) {
          const scrollTarget = document.querySelector(step.selector);
          if (!(scrollTarget instanceof HTMLElement)) throw new Error(`Recorded scroll target is unavailable: ${step.label || step.selector}`);
          scrollTarget.scrollTo({ left: step.scrollX ?? 0, top: step.scrollY ?? 0, behavior: "smooth" });
        } else window.scrollTo({ left: step.scrollX ?? 0, top: step.scrollY ?? 0, behavior: "smooth" });
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
      if (step.action === "fill" || step.action === "select") {
        if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
          if (typeof step.checked === "boolean" && element.checked !== step.checked) await simulateClick(element);
        } else setElementValue(element, step.value ?? "");
      }
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
    hideAgentFrame(650);
  }
}

function recordFormValue(target: HTMLElement) {
  const sensitive = isSensitiveElement(target);
  const checkable = target instanceof HTMLInputElement && ["checkbox", "radio"].includes(target.type);
  const value = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
    ? target.value
    : target.textContent ?? "";
  recordAction({
    action: target instanceof HTMLSelectElement || checkable ? "select" : "fill",
    selector: buildSelector(target),
    label: getAccessibleLabel(target) || target.getAttribute("name") || target.getAttribute("placeholder") || undefined,
    value: sensitive || checkable ? undefined : value,
    ...(checkable ? { checked: target.checked } : {}),
    sensitive,
  });
}

function recordAction(action: Omit<RecordedBrowserAction, "id" | "url" | "timestamp">) {
  const payload: RecordedBrowserAction = { ...action, id: "pending", url: location.href, timestamp: Date.now() };
  void chrome.runtime.sendMessage({ type: "page.recording.action", action: payload }).catch(() => undefined);
}
