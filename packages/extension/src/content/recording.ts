import type { RecordedBrowserAction } from "@auto-page-agent/shared";
import { hideAgentFrame, showAgentFrame, showAiPointer } from "./agent-activity.js";
import { buildSelector, cleanText, delay, getAccessibleLabel, isSensitiveElement, isVisible, setElementValue, simulateClick } from "./dom.js";

let recordingActive = false;
let scrollTimer: number | undefined;

export function setRecordingActive(active: boolean) {
  recordingActive = active;
}

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

export async function replayRecordedActions(actions: RecordedBrowserAction[]) {
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
    hideAgentFrame(650);
  }
}

function recordAction(action: Omit<RecordedBrowserAction, "id" | "url" | "timestamp">) {
  const payload: RecordedBrowserAction = { ...action, id: "pending", url: location.href, timestamp: Date.now() };
  void chrome.runtime.sendMessage({ type: "page.recording.action", action: payload }).catch(() => undefined);
}
