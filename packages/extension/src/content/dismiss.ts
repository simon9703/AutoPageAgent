export interface DismissKeyboardTarget {
  focus(options?: FocusOptions): void;
  dispatchEvent(event: Event): boolean;
}

type KeyboardEventFactory = (type: "keydown" | "keyup", init: KeyboardEventInit) => Event;
type PointerEventFactory = (type: "pointerdown" | "pointerup", init: PointerEventInit) => Event;
type MouseEventFactory = (type: "mousedown" | "mouseup" | "click", init: MouseEventInit) => Event;

export interface DismissPointerTarget {
  dispatchEvent(event: Event): boolean;
  click?: () => void;
}

const ESCAPE_KEY_CODE = 27;
const SAFE_POINT_INSET = 12;
const POPUP_EDGE_PADDING = 6;
const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "option",
  "label",
  "summary",
  "[contenteditable='true']",
  "[onclick]",
  "[role='button']",
  "[role='link']",
  "[role='textbox']",
  "[role='combobox']",
  "[role='option']",
  "[role='menuitem']",
  "[role='tab']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='slider']",
  "[role='spinbutton']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export interface DismissPoint {
  x: number;
  y: number;
}

export interface DismissRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function dispatchEscapeKey(
  recipient: DismissKeyboardTarget,
  createEvent: KeyboardEventFactory = (type, init) => new KeyboardEvent(type, init),
): void {
  recipient.focus({ preventScroll: true });
  const keyboardInit: KeyboardEventInit = {
    key: "Escape",
    code: "Escape",
    location: 0,
    repeat: false,
    isComposing: false,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  for (const type of ["keydown", "keyup"] as const) {
    const event = createEvent(type, keyboardInit);
    exposeLegacyEscapeCodes(event);
    recipient.dispatchEvent(event);
  }
}

export function clickSafePopupExterior(origin: HTMLElement): boolean {
  const popupRoots = resolvePopupRoots(origin);
  if (!popupRoots.length) return false;
  const dialog = resolveDismissDialog(origin);
  const searchRect = dialog
    ? clipRectToViewport(dialog.getBoundingClientRect())
    : viewportRect();
  if (!searchRect || searchRect.width < SAFE_POINT_INSET * 2 || searchRect.height < SAFE_POINT_INSET * 2) {
    return false;
  }

  const popupRects = popupRoots.map((root) => root.getBoundingClientRect());
  const resolved = findSafeDismissPoint(searchRect, popupRects, (point) =>
    resolveSafeExteriorTarget(point, popupRoots, dialog));
  if (!resolved) return false;
  dispatchElementClick(resolved.target, resolved.point);
  return true;
}

export function isPopupDismissTargetOpen(origin: HTMLElement): boolean {
  const role = origin.getAttribute("role");
  if (!origin.isConnected) return false;
  if (role === "combobox" && origin.getAttribute("aria-expanded") !== "true") return false;
  const popupRoots = resolvePopupRoots(origin);
  if (!popupRoots.length) return role === "combobox";
  return popupRoots.some((root) => root.isConnected && hasVisibleArea(root));
}

export function dispatchElementClick(
  target: DismissPointerTarget,
  point: DismissPoint,
  createPointerEvent: PointerEventFactory = (type, init) => new PointerEvent(type, init),
  createMouseEvent: MouseEventFactory = (type, init) => new MouseEvent(type, init),
): void {
  const mouseInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: point.x,
    clientY: point.y,
    button: 0,
  };
  const pointerInit: PointerEventInit = { ...mouseInit, pointerType: "mouse", isPrimary: true };
  target.dispatchEvent(createPointerEvent("pointerdown", pointerInit));
  target.dispatchEvent(createMouseEvent("mousedown", mouseInit));
  target.dispatchEvent(createPointerEvent("pointerup", pointerInit));
  target.dispatchEvent(createMouseEvent("mouseup", mouseInit));
  if (target.click) target.click();
  else target.dispatchEvent(createMouseEvent("click", mouseInit));
}

export function findSafeDismissPoint<T>(
  searchRect: DismissRect,
  popupRects: DismissRect[],
  resolveTarget: (point: DismissPoint) => T | undefined,
): { point: DismissPoint; target: T } | undefined {
  for (const point of buildCandidatePoints(searchRect)) {
    if (popupRects.some((popupRect) => containsPoint(popupRect, point, POPUP_EDGE_PADDING))) continue;
    const target = resolveTarget(point);
    if (target !== undefined) return { point, target };
  }
  return undefined;
}

function exposeLegacyEscapeCodes(event: Event): void {
  for (const property of ["keyCode", "which"] as const) {
    try {
      Object.defineProperty(event, property, {
        configurable: true,
        enumerable: true,
        get: () => ESCAPE_KEY_CODE,
      });
    } catch {
      // Modern components use key/code. Legacy numeric fields are best-effort
      // compatibility only and must not turn dispatch into a reported success.
    }
  }
}

function resolvePopupRoots(origin: HTMLElement): HTMLElement[] {
  const role = origin.getAttribute("role");
  if (role === "listbox" || role === "menu") return [resolveVisiblePopupRegion(origin)];
  if (role === "option") {
    const owner = origin.closest('[role="listbox"],[role="menu"]');
    return owner instanceof HTMLElement ? [resolveVisiblePopupRegion(owner)] : [];
  }
  if (role !== "combobox") return [];
  const ids = [
    origin.getAttribute("aria-controls"),
    origin.getAttribute("aria-owns"),
  ].filter(Boolean).flatMap((value) => value!.split(/\s+/u).filter(Boolean));
  return ids.flatMap((id) => {
    const root = document.getElementById(id);
    return root instanceof HTMLElement && ["listbox", "menu"].includes(root.getAttribute("role") ?? "")
      ? [resolveVisiblePopupRegion(root)]
      : [];
  }).filter((root, index, roots) => roots.indexOf(root) === index);
}

function resolveVisiblePopupRegion(root: HTMLElement): HTMLElement {
  if (hasVisibleArea(root)) return root;
  let closestVisible: HTMLElement | undefined;
  let candidate = root.parentElement;
  while (candidate && candidate !== document.body && candidate !== document.documentElement) {
    if (candidate.getAttribute("role") === "dialog") break;
    if (hasVisibleArea(candidate)) {
      closestVisible ??= candidate;
      const style = getComputedStyle(candidate);
      if (style.position === "absolute" || style.position === "fixed" || style.zIndex !== "auto") {
        return candidate;
      }
    }
    candidate = candidate.parentElement;
  }
  return closestVisible ?? root;
}

function hasVisibleArea(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 1
    && rect.height > 1
    && style.display !== "none"
    && style.visibility !== "hidden";
}

function resolveDismissDialog(origin: HTMLElement): HTMLElement | undefined {
  const containingDialog = origin.closest('[role="dialog"]');
  if (containingDialog instanceof HTMLElement) return containingDialog;
  return Array.from(document.querySelectorAll('[role="dialog"]'))
    .filter((candidate): candidate is HTMLElement => {
      if (!(candidate instanceof HTMLElement)) return false;
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      return rect.width > 0
        && rect.height > 0
        && style.display !== "none"
        && style.visibility !== "hidden";
    })
    .sort((left, right) => {
      const zDifference = numericZIndex(left) - numericZIndex(right);
      if (zDifference) return zDifference;
      return elementDepth(left) - elementDepth(right);
    })
    .at(-1);
}

function resolveSafeExteriorTarget(
  point: DismissPoint,
  popupRoots: HTMLElement[],
  dialog?: HTMLElement,
): Element | undefined {
  const target = document.elementsFromPoint(point.x, point.y)
    .find((candidate) => !candidate.closest("[data-auto-page-agent-overlay]"));
  if (!target) return undefined;
  if (dialog && !dialog.contains(target)) return undefined;
  if (popupRoots.some((root) => root === target || root.contains(target))) return undefined;
  if (target.closest(INTERACTIVE_SELECTOR)) return undefined;
  if (getComputedStyle(target).cursor === "pointer") return undefined;
  return target;
}

function buildCandidatePoints(rect: DismissRect): DismissPoint[] {
  const xs = [
    rect.left + SAFE_POINT_INSET,
    rect.right - SAFE_POINT_INSET,
    rect.left + rect.width * 0.25,
    rect.left + rect.width * 0.75,
    rect.left + rect.width * 0.5,
  ];
  const ys = [
    rect.top + SAFE_POINT_INSET,
    rect.bottom - SAFE_POINT_INSET,
    rect.top + rect.height * 0.25,
    rect.top + rect.height * 0.75,
    rect.top + rect.height * 0.5,
  ];
  const points: DismissPoint[] = [];
  for (const y of ys) {
    for (const x of xs) points.push({ x: Math.round(x), y: Math.round(y) });
  }
  return points;
}

function containsPoint(rect: DismissRect, point: DismissPoint, padding: number): boolean {
  return point.x >= rect.left - padding
    && point.x <= rect.right + padding
    && point.y >= rect.top - padding
    && point.y <= rect.bottom + padding;
}

function viewportRect(): DismissRect {
  return { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight };
}

function clipRectToViewport(rect: DOMRect): DismissRect | undefined {
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(innerWidth, rect.right);
  const bottom = Math.min(innerHeight, rect.bottom);
  if (right <= left || bottom <= top) return undefined;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function elementDepth(element: Element): number {
  let depth = 0;
  for (let current = element.parentElement; current; current = current.parentElement) depth += 1;
  return depth;
}

function numericZIndex(element: Element): number {
  const value = Number.parseInt(getComputedStyle(element).zIndex, 10);
  return Number.isFinite(value) ? value : 0;
}
