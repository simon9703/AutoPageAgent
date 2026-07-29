import type { InspectedElement, PageElementSnapshot } from "@auto-page-agent/shared";

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function inspectElement(element: Element): InspectedElement {
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

export function setElementValue(element: HTMLElement, value: string) {
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

export function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

export function isNearViewport(element: Element, expansion: number): boolean {
  const rect = element.getBoundingClientRect();
  return rect.bottom >= -expansion && rect.top <= innerHeight + expansion && rect.right >= -expansion && rect.left <= innerWidth + expansion;
}

export function isTopLayerElement(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) return true;
  const x = Math.min(Math.max(rect.left + rect.width / 2, 0), innerWidth - 1);
  const y = Math.min(Math.max(rect.top + rect.height / 2, 0), innerHeight - 1);
  const top = document.elementFromPoint(x, y);
  return !top || top === element || element.contains(top) || top.contains(element);
}

export function isHiddenInput(element: Element): boolean {
  return element instanceof HTMLInputElement && element.type === "hidden";
}

export function isDisabledElement(element: Element): boolean {
  return element.getAttribute("aria-disabled") === "true"
    || ("disabled" in element && Boolean((element as HTMLInputElement).disabled));
}

export function isReadonlyElement(element: Element): boolean {
  return "readOnly" in element && Boolean((element as HTMLInputElement).readOnly);
}

export function isComboboxLike(element: Element): boolean {
  return element.getAttribute("role") === "combobox"
    || element.getAttribute("aria-autocomplete") === "list"
    || element.hasAttribute("aria-controls")
    || element.hasAttribute("aria-expanded");
}

export function isAvailableOption(element: Element): boolean {
  const isOption = element.getAttribute("role") === "option" || element.hasAttribute("aria-selected");
  return isOption
    && isVisible(element)
    && isNearViewport(element, 700)
    && isTopLayerElement(element)
    && !isDisabledElement(element);
}

export function isSensitiveElement(element: Element): boolean {
  const inputType = element instanceof HTMLInputElement ? element.type : "";
  const metadata = [
    element.getAttribute("name"),
    element.getAttribute("id"),
    element.getAttribute("autocomplete"),
    element.getAttribute("placeholder"),
    element.getAttribute("aria-label"),
  ].filter(Boolean).join(" ");
  return ["password", "file"].includes(inputType)
    || /password|passcode|secret|token|otp|one[- ]?time|card|cvv|cvc|credential|api[-_ ]?key/iu.test(metadata);
}

export function isSensitiveCaptureTarget(element: Element): boolean {
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

export function shouldExposeValue(element: Element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) && !isSensitiveElement(element);
}

export function getSelectedValues(element: Element): string[] {
  if (isSensitiveElement(element)) return [];
  if (element instanceof HTMLSelectElement) {
    return uniqueText(Array.from(element.selectedOptions)
      .map((option) => option.label || option.textContent || option.value));
  }
  if (!isComboboxLike(element)) return [];

  const semanticValues = resolveControlledRoots(element)
    .flatMap((root) => Array.from(root.querySelectorAll('[role="option"][aria-selected="true"],[aria-selected="true"]')))
    .map((option) => getAccessibleLabel(option) || option.textContent || "");
  const selectedValues = uniqueText(semanticValues);
  if (selectedValues.length) return selectedValues;

  return findVisibleSelectionLabels(element);
}

function resolveControlledRoots(element: Element): Element[] {
  const ids = [
    element.getAttribute("aria-controls"),
    element.getAttribute("aria-owns"),
  ].filter(Boolean).flatMap((value) => value!.split(/\s+/u).filter(Boolean));
  return ids.flatMap((id) => {
    const root = document.getElementById(id);
    return root ? [root] : [];
  });
}

function findVisibleSelectionLabels(control: Element): string[] {
  const excluded = new Set(uniqueText([
    getAccessibleLabel(control),
    control.getAttribute("placeholder") || "",
    control instanceof HTMLInputElement ? control.value : "",
  ]));
  let ancestor = control.parentElement;
  for (let depth = 0; ancestor && depth < 3; depth += 1, ancestor = ancestor.parentElement) {
    const values = uniqueText(Array.from(ancestor.querySelectorAll("*"))
      .filter((candidate) =>
        !candidate.contains(control)
        && !candidate.matches('label,[role="option"],[role="listbox"],[role="menu"],[aria-hidden="true"]')
        && isVisible(candidate))
      .filter((candidate) => !Array.from(candidate.children).some((child) =>
        isVisible(child) && Boolean(cleanText(child.textContent || "", 300))))
      .map((candidate) => candidate.textContent || "")
      .filter((value) => !excluded.has(value)));
    if (values.length) return values.slice(0, 20);
  }
  return [];
}

function uniqueText(values: Array<string | null | undefined>): string[] {
  const normalized = values
    .map((value) => cleanText(value || "", 300))
    .filter(Boolean);
  return [...new Set(normalized)];
}

export function getAccessibleLabel(element: Element): string {
  const labelledBy = element.getAttribute("aria-labelledby");
  const labelledText = labelledBy ? labelledBy.split(/\s+/u).map((id) => document.getElementById(id)?.textContent ?? "").join(" ") : "";
  const inputLabel = element instanceof HTMLElement && element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent : "";
  return cleanText(element.getAttribute("aria-label") || labelledText || inputLabel || element.getAttribute("title") || "", 300);
}

export function inferRole(element: Element): string {
  if (element instanceof HTMLButtonElement) return "button";
  if (element instanceof HTMLAnchorElement) return "link";
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return "textbox";
  if (element instanceof HTMLSelectElement) return "combobox";
  if (element.hasAttribute("aria-selected")) return "option";
  return "";
}

export function buildSelector(element: Element): string {
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

export function createElementFingerprint(element: Element): string {
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

export function buildSimplifiedDom(elements: PageElementSnapshot[], elementRefs: ReadonlyMap<string, Element>): string {
  if (!elements.length) return "<EMPTY>";
  const visualIndexes = new Map(elements.map((element, index) => [element.ref, index + 1]));
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
    ...group.map((element) => `  ${simplifyElement(element, visualIndexes.get(element.ref)!)}`),
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
    typeof element.selected === "boolean" ? `aria-selected="${element.selected}"` : "",
    element.multiple ? 'aria-multiselectable="true"' : "",
    element.current ? 'aria-current="page"' : "",
    element.relation ? `rel="${element.relation === "previous" ? "prev" : "next"}"` : "",
    typeof element.expanded === "boolean" ? `aria-expanded="${element.expanded}"` : "",
    element.busy ? 'aria-busy="true"' : "",
    element.domId ? `id="${escapeDomText(element.domId)}"` : "",
    element.controls ? `aria-controls="${escapeDomText(element.controls)}"` : "",
    element.owns ? `aria-owns="${escapeDomText(element.owns)}"` : "",
    element.activeDescendant ? `aria-activedescendant="${escapeDomText(element.activeDescendant)}"` : "",
    element.ownerId ? `data-ai-owner="${escapeDomText(element.ownerId)}"` : "",
    element.layerId ? `data-ai-layer="${escapeDomText(element.layerId)}"` : "",
    element.parentLayerId ? `data-ai-parent-layer="${escapeDomText(element.parentLayerId)}"` : "",
    element.scrollable ? 'data-scrollable="true"' : "",
    element.scrollPosition
      ? `data-scroll-position="${element.scrollPosition.x},${element.scrollPosition.y}/${element.scrollPosition.maxX},${element.scrollPosition.maxY}"`
      : "",
    element.sensitive ? 'data-sensitive="true"' : "",
    element.displayValue ? `data-display-value="${escapeDomText(element.displayValue)}"` : "",
    element.selectedValues?.length ? `data-selected-values="${escapeDomText(element.selectedValues.join(" | "))}"` : "",
  ].filter(Boolean).join(" ");
  const text = escapeDomText(cleanText(element.text || element.displayValue || element.value || "", 180));
  return `[${index}]<${element.tagName}${attributes ? ` ${attributes}` : ""}>${text}</${element.tagName}>`;
}

export function collectPageInfo() {
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

export function resolveCaptureTarget(x: number, y: number, fallback: Element): Element {
  const hitElements = document.elementsFromPoint(x, y)
    .filter((element) => !element.closest("[data-auto-page-agent-overlay]"));
  const media = hitElements.map(getVisualMediaTarget).find((element): element is Element => Boolean(element));
  if (media) return media;

  const direct = hitElements[0] ?? fallback;
  if (hasBackgroundImage(direct)) return direct;
  let ancestor = direct.parentElement;
  for (let depth = 0; ancestor && ancestor !== document.body && depth < 3; depth += 1, ancestor = ancestor.parentElement) {
    if (hasBackgroundImage(ancestor)) return ancestor;
  }
  return direct;
}

function getVisualMediaTarget(element: Element): Element | null {
  if (element instanceof SVGElement) return element.closest("svg") ?? element;
  if (element instanceof HTMLImageElement
    || element instanceof HTMLCanvasElement
    || element instanceof HTMLVideoElement
    || element.getAttribute("role") === "img") return element;
  return null;
}

function hasBackgroundImage(element: Element): boolean {
  return element instanceof HTMLElement && /(?:^|,)\s*url\(/u.test(getComputedStyle(element).backgroundImage);
}

export async function simulateClick(element: HTMLElement) {
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

function escapeDomText(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

export function cleanText(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function round(value: number): number {
  return Math.round(value * 10) / 10;
}
