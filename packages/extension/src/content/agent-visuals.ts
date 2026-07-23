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
  setImportantStyles(pointer, {
    position: "fixed",
    zIndex: "2147483647",
    left: "0",
    top: "0",
    width: "1px",
    height: "1px",
    opacity: "0",
    overflow: "visible",
    pointerEvents: "none",
  });
  const arrow = pointer.querySelector<SVGElement>(".auto-page-agent-pointer-arrow");
  if (arrow) setImportantStyles(arrow, {
    position: "absolute",
    left: "-4px",
    top: "-4px",
    width: "32px",
    height: "39px",
    overflow: "visible",
  });
  const arrowPath = pointer.querySelector<SVGPathElement>(".auto-page-agent-pointer-arrow path");
  if (arrowPath) setImportantStyles(arrowPath, {
    fill: "white",
    stroke: "#7657f5",
    strokeWidth: "3.4px",
    strokeLinejoin: "round",
  });
  document.documentElement.append(pointer);
  return pointer;
}

function positionPointer(pointer: HTMLElement, x: number, y: number) {
  pointer.style.setProperty("transform", `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`, "important");
  pointer.style.setProperty("opacity", "1", "important");
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
  setImportantStyles(outline, {
    position: "fixed",
    zIndex: "2147483645",
    left: "0",
    top: "0",
    boxSizing: "border-box",
    opacity: "0",
    pointerEvents: "none",
    border: kind === "selected" ? "2px solid #6d5dfc" : "2px solid #8b5cf6",
    borderRadius: "6px",
    background: kind === "selected"
      ? "linear-gradient(135deg, rgba(124, 92, 255, .10), rgba(56, 189, 248, .07))"
      : "rgba(139, 92, 246, .04)",
    boxShadow: kind === "selected"
      ? "inset 0 0 0 1px rgba(255,255,255,.82), 0 0 0 4px rgba(124,92,255,.18), 0 10px 34px rgba(67,56,202,.22)"
      : "inset 0 0 0 1px rgba(255,255,255,.70), 0 0 0 3px rgba(139,92,246,.12), 0 8px 30px rgba(76,29,149,.14)",
  });
  outline.querySelectorAll<HTMLElement>(".auto-page-agent-corner").forEach((corner) => {
    setImportantStyles(corner, {
      position: "absolute",
      width: "10px",
      height: "10px",
      borderColor: "#7657f5",
    });
  });
  const corners = {
    ".top-left": { left: "-4px", top: "-4px", borderLeft: "3px solid #7657f5", borderTop: "3px solid #7657f5" },
    ".top-right": { right: "-4px", top: "-4px", borderRight: "3px solid #7657f5", borderTop: "3px solid #7657f5" },
    ".bottom-left": { left: "-4px", bottom: "-4px", borderLeft: "3px solid #7657f5", borderBottom: "3px solid #7657f5" },
    ".bottom-right": { right: "-4px", bottom: "-4px", borderRight: "3px solid #7657f5", borderBottom: "3px solid #7657f5" },
  } satisfies Record<string, Record<string, string>>;
  for (const [selector, styles] of Object.entries(corners)) {
    const corner = outline.querySelector<HTMLElement>(selector);
    if (corner) setImportantStyles(corner, styles);
  }
  const label = outline.querySelector<HTMLElement>(".auto-page-agent-outline-label");
  if (label) setImportantStyles(label, {
    position: "absolute",
    left: "-1px",
    bottom: "calc(100% + 7px)",
    maxWidth: "min(280px, 70vw)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    padding: "4px 8px",
    border: "1px solid rgba(255,255,255,.25)",
    borderRadius: "7px",
    color: "white",
    background: "linear-gradient(135deg, #5b31d2, #7657f5)",
    boxShadow: "0 5px 16px rgba(76,29,149,.27)",
    font: "650 10px/1.25 Inter, ui-sans-serif, system-ui, sans-serif",
  });
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
  outline.style.setProperty("transform", `translate3d(${Math.round(left)}px,${Math.round(top)}px,0)`, "important");
  outline.style.setProperty("width", `${Math.max(0, Math.round(right - left))}px`, "important");
  outline.style.setProperty("height", `${Math.max(0, Math.round(bottom - top))}px`, "important");
  outline.classList.toggle("label-below", top < 34);
  outline.style.setProperty("opacity", outline.classList.contains("offscreen") ? "0" : "1", "important");
  const labelElement = outline.querySelector<HTMLElement>(".auto-page-agent-outline-label")!;
  labelElement.textContent = label;
  labelElement.style.setProperty("top", top < 34 ? "calc(100% + 7px)" : "auto", "important");
  labelElement.style.setProperty("bottom", top < 34 ? "auto" : "calc(100% + 7px)", "important");
}

function describeElement(element: Element): string {
  const role = element.getAttribute("role");
  const identity = element.id ? `#${element.id}` : element.getAttribute("aria-label");
  return [element.tagName.toLowerCase(), role, identity].filter(Boolean).join(" · ");
}

function setImportantStyles(element: HTMLElement | SVGElement, styles: Record<string, string>) {
  for (const [property, value] of Object.entries(styles)) {
    element.style.setProperty(property.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`), value, "important");
  }
}
