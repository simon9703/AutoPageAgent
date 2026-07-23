let selectedTarget: Element | null = null;
let selectedOutline: HTMLElement | null = null;
let selectedOutlineCleanup: (() => void) | null = null;

export interface PickerVisuals {
  movePointer(x: number, y: number): void;
  showTarget(target: Element): void;
  clearTarget(): void;
  destroy(): void;
}

export function createPickerVisuals(): PickerVisuals {
  const pointer = createPointer("auto-page-agent-picker-pointer");
  const outline = createElementOutline("picker");
  return {
    movePointer: (x, y) => positionPointer(pointer, x, y),
    showTarget: (target) => {
      positionElementOutline(outline, target, describeElement(target));
      outline.classList.add("visible");
    },
    clearTarget: () => outline.classList.remove("visible"),
    destroy: () => {
      pointer.remove();
      outline.remove();
    },
  };
}

export function setSelectedTarget(target: Element) {
  clearSelectedTarget();
  selectedTarget = target;
  selectedOutline = createElementOutline("selected");
  let updateFrame: number | undefined;
  const update = () => {
    if (!selectedTarget?.isConnected || !selectedOutline) {
      clearSelectedTarget();
      return;
    }
    positionElementOutline(selectedOutline, selectedTarget, `Selected · ${describeElement(selectedTarget)}`);
    selectedOutline.classList.add("visible");
  };
  const scheduleUpdate = () => {
    if (updateFrame !== undefined) cancelAnimationFrame(updateFrame);
    updateFrame = requestAnimationFrame(() => {
      updateFrame = undefined;
      update();
    });
  };
  const observer = new ResizeObserver(scheduleUpdate);
  observer.observe(target);
  window.addEventListener("resize", scheduleUpdate);
  document.addEventListener("scroll", scheduleUpdate, true);
  selectedOutlineCleanup = () => {
    if (updateFrame !== undefined) cancelAnimationFrame(updateFrame);
    observer.disconnect();
    window.removeEventListener("resize", scheduleUpdate);
    document.removeEventListener("scroll", scheduleUpdate, true);
  };
  update();
}

export function clearSelectedTarget() {
  selectedOutlineCleanup?.();
  selectedOutlineCleanup = null;
  selectedOutline?.remove();
  selectedOutline = null;
  selectedTarget = null;
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

function positionPointer(pointer: HTMLElement, x: number, y: number) {
  pointer.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
  pointer.classList.add("visible");
}

function createElementOutline(kind: "picker" | "selected"): HTMLElement {
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

function positionElementOutline(outline: HTMLElement, target: Element, label: string) {
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
