import type { ElementSelectionGeometry } from "@auto-page-agent/shared";
import { clearSelectedTarget, createPickerVisuals, setSelectedTarget } from "./agent-visuals.js";
import { inspectElement, isSensitiveCaptureTarget, resolveCaptureTarget } from "./dom.js";

let selectionCleanup: (() => void) | null = null;

export function clearElementSelection() {
  selectionCleanup?.();
  clearSelectedTarget();
}

export function startElementSelection(mode: "element" | "image") {
  selectionCleanup?.();
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
    const next = raw && mode === "image"
      ? resolveCaptureTarget(event.clientX, event.clientY, raw)
      : raw;
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
      ? resolveCaptureTarget(event.clientX, event.clientY, event.target)
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
