import { delay } from "./dom.js";

let aiPointer: HTMLElement | null = null;
let actionOutline: HTMLElement | null = null;
let agentFrame: HTMLElement | null = null;
let persistentAgentActivity = false;
let agentFrameHideTimer: number | undefined;

export function setAgentActivity(active: boolean) {
  persistentAgentActivity = active;
  if (active) showAgentFrame();
  else hideAgentFrame();
}

export async function showAiPointer(element: HTMLElement, label: string) {
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

export function showAgentFrame() {
  ensureAgentStyles();
  window.clearTimeout(agentFrameHideTimer);
  agentFrameHideTimer = undefined;
  if (!agentFrame) {
    agentFrame = document.createElement("auto-page-agent-frame");
    agentFrame.dataset.autoPageAgentOverlay = "true";
    agentFrame.className = "auto-page-agent-viewport-frame";
    setAgentFrameHostStyles(agentFrame);
    const shadow = agentFrame.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        :host { color-scheme: light; }
        .edge { position: absolute; display: block; pointer-events: none; background: linear-gradient(115deg,#22d3ee,#6366f1,#a855f7,#ec4899,#22d3ee); background-size: 300% 300%; box-shadow: 0 0 10px #6366f180; animation: flow 4s linear infinite; }
        .top { top: 0; right: 0; left: 0; height: 4px; }
        .right { top: 0; right: 0; bottom: 0; width: 4px; }
        .bottom { right: 0; bottom: 0; left: 0; height: 4px; }
        .left { top: 0; bottom: 0; left: 0; width: 4px; }
        .status { position: absolute; right: 15px; bottom: 14px; display: flex; align-items: center; gap: 7px; padding: 7px 11px; border: 1px solid #ffffff3d; border-radius: 999px; color: white; background: #17132be8; backdrop-filter: blur(12px); box-shadow: 0 8px 24px #312e8150; font: 650 11px/1 Inter,ui-sans-serif,system-ui,sans-serif; letter-spacing: .02em; white-space: nowrap; pointer-events: none; }
        .status i { display: block; width: 7px; height: 7px; border-radius: 50%; background: #67e8f9; box-shadow: 0 0 0 4px #22d3ee25,0 0 12px #22d3ee; animation: pulse 1.4s ease-in-out infinite; }
        @keyframes flow { to { background-position: 300% 50%; } }
        @keyframes pulse { 50% { opacity: .45; transform: scale(.72); } }
        @media (prefers-reduced-motion: reduce) { .edge,.status i { animation: none; } }
      </style>
      <span class="edge top"></span>
      <span class="edge right"></span>
      <span class="edge bottom"></span>
      <span class="edge left"></span>
      <span class="status"><i></i> AI is operating</span>
    `;
    document.documentElement.append(agentFrame);
  }
  requestAnimationFrame(() => agentFrame?.style.setProperty("opacity", "1", "important"));
}

export function hideAgentFrame(delayMs = 0) {
  window.clearTimeout(agentFrameHideTimer);
  agentFrameHideTimer = window.setTimeout(() => {
    if (persistentAgentActivity) return;
    agentFrame?.style.setProperty("opacity", "0", "important");
  }, delayMs);
}

function setAgentFrameHostStyles(host: HTMLElement) {
  const styles: Record<string, string> = {
    all: "initial",
    position: "fixed",
    zIndex: "2147483643",
    inset: "0",
    display: "block",
    boxSizing: "border-box",
    opacity: "0",
    pointerEvents: "none",
    overflow: "visible",
    border: "0",
    borderRadius: "0",
    background: "transparent",
    boxShadow: "none",
    transition: "opacity .28s ease",
    contain: "strict",
  };
  for (const [property, value] of Object.entries(styles)) {
    host.style.setProperty(property.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`), value, "important");
  }
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
    .auto-page-agent-viewport-frame { position: fixed; z-index: 2147483643; inset: 0; box-sizing: border-box; opacity: 0; pointer-events: none; border: 0; border-radius: 12px; background: transparent; box-shadow: none; transition: opacity .28s ease; }
    .auto-page-agent-frame-edge { position: absolute; display: block; background: linear-gradient(115deg,#22d3ee,#6366f1,#a855f7,#ec4899,#22d3ee); background-size: 300% 300%; box-shadow: 0 0 10px #6366f180; animation: auto-page-agent-frame-flow 4s linear infinite; }
    .auto-page-agent-frame-edge.top { top: 0; left: 0; right: 0; height: 4px; }
    .auto-page-agent-frame-edge.right { top: 0; right: 0; bottom: 0; width: 4px; }
    .auto-page-agent-frame-edge.bottom { right: 0; bottom: 0; left: 0; height: 4px; }
    .auto-page-agent-frame-edge.left { top: 0; bottom: 0; left: 0; width: 4px; }
    .auto-page-agent-viewport-frame.visible { opacity: 1; }
    .auto-page-agent-frame-status { position: absolute; right: 15px; bottom: 14px; display: flex; align-items: center; gap: 7px; padding: 6px 10px; border: 1px solid #ffffff3d; border-radius: 999px; color: white; background: #17132bdc; backdrop-filter: blur(12px); box-shadow: 0 8px 24px #312e8150; font: 650 10px/1 system-ui,-apple-system,sans-serif; letter-spacing: .02em; }
    .auto-page-agent-frame-status i { width: 7px; height: 7px; border-radius: 50%; background: #67e8f9; box-shadow: 0 0 0 4px #22d3ee25,0 0 12px #22d3ee; animation: auto-page-agent-status-pulse 1.4s ease-in-out infinite; }
    @keyframes auto-page-agent-frame-flow { to { background-position: 300% 50%; } }
    @keyframes auto-page-agent-status-pulse { 50% { opacity: .45; transform: scale(.72); } }
    @keyframes auto-page-agent-pointer-press { 50% { transform: scale(.82) rotate(-3deg); } }
    @keyframes auto-page-agent-click-ripple { 0% { opacity: .95; transform: scale(.25); } 100% { opacity: 0; transform: scale(2.25); } }
    @keyframes auto-page-agent-target-pop { 50% { box-shadow: 0 0 0 9px #22d3ee28,0 0 40px #7c3aed5c; } }
    @media (prefers-reduced-motion: reduce) { .auto-page-agent-pointer,.auto-page-agent-element-outline,.auto-page-agent-viewport-frame { transition-duration: .01ms; animation: none; } }
  `;
  document.documentElement.append(style);
}
