export type BrowserActionKind = "click" | "fill" | "select" | "scroll" | "focus" | "submit";

export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageElementSnapshot {
  ref: string;
  tagName: string;
  role: string;
  label: string;
  text: string;
  selector: string;
  value?: string;
  href?: string;
  placeholder?: string;
  inputType?: string;
  disabled: boolean;
  sensitive: boolean;
  contentEditable: boolean;
  fingerprint: string;
  inViewport: boolean;
  occluded: boolean;
  readonly: boolean;
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
  busy?: boolean;
  domId?: string;
  controls?: string;
  owns?: string;
  activeDescendant?: string;
  ownerId?: string;
  viewportRect: ViewportRect;
}

export interface InspectedElement {
  tagName: string;
  role: string;
  label: string;
  text: string;
  placeholder?: string;
  inputType?: string;
  attributes: Record<string, string>;
  nearbyText: string;
  selector?: string;
  image?: {
    src: string;
    alt: string;
    width: number;
    height: number;
  };
  source?: {
    component?: string;
    file?: string;
    repository?: string;
  };
}

export interface ElementSelectionGeometry {
  rect: ViewportRect;
  viewportWidth: number;
  viewportHeight: number;
}

export interface ResourceTimingSnapshot {
  name: string;
  initiatorType: string;
  duration: number;
  transferSize: number;
  encodedBodySize: number;
}

export interface ApiRequestSnapshot {
  url: string;
  pathname: string;
  initiatorType: "fetch" | "xmlhttprequest";
  duration: number;
  transferSize: number;
}

export interface PerformanceSnapshot {
  navigation?: { ttfb: number; domContentLoaded: number; load: number };
  resources: ResourceTimingSnapshot[];
  apiRequests: ApiRequestSnapshot[];
  summary: {
    requestCount: number;
    totalTransferSize: number;
    slowRequestCount: number;
  };
}

export interface BrowserTabTarget {
  tabId: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  active: boolean;
}

export interface PageInfoSnapshot {
  viewportWidth: number;
  viewportHeight: number;
  pageWidth: number;
  pageHeight: number;
  scrollX: number;
  scrollY: number;
  pixelsAbove: number;
  pixelsBelow: number;
}

export interface PageSnapshot {
  snapshotId: string;
  url: string;
  title: string;
  language: string;
  selectedText: string;
  headings: Array<{ level: number; text: string }>;
  mainText: string;
  simplifiedDom: string;
  pageInfo: PageInfoSnapshot;
  context?: {
    selectedElement?: InspectedElement;
    screenshot?: { dataUrl: string; title: string; url: string };
  };
  elements: PageElementSnapshot[];
  performance?: PerformanceSnapshot;
  capturedAt: string;
  domVersion: number;
}

export interface PageSnapshotDiff {
  urlChanged: boolean;
  titleChanged: boolean;
  addedFingerprints: string[];
  removedFingerprints: string[];
  changedFingerprints: string[];
  summary: string[];
}

export interface BrowserActionStep {
  action: BrowserActionKind;
  targetRef?: string;
  value?: string;
  direction?: "up" | "down" | "left" | "right" | "top" | "bottom";
  amountPx?: number;
  reason: string;
}

export interface ActionVerification {
  success: boolean;
  summary: string;
  changes: string[];
  diff: PageSnapshotDiff;
}

export interface ActionExecutionResult {
  ok: boolean;
  results?: Array<{ action: string; ok: true }>;
  snapshot?: PageSnapshot;
  verification?: ActionVerification;
  error?: string;
}
