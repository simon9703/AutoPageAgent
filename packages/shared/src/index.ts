export * from "./agent-events.js";

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

export type RepositoryEvidenceKind = "source" | "api" | "text" | "symbol";

export interface RepositoryEvidence {
  kind: RepositoryEvidenceKind;
  repository: string;
  path: string;
  line: number;
  preview: string;
  matchedTerm: string;
  confidence: "high" | "medium" | "low";
}

export interface RepositoryAnalysis {
  queryTerms: string[];
  repositories: string[];
  evidence: RepositoryEvidence[];
  warnings: string[];
}

export interface ResourceTimingSnapshot {
  name: string;
  initiatorType: string;
  duration: number;
  transferSize: number;
  encodedBodySize: number;
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

export interface ApiRequestSnapshot {
  url: string;
  pathname: string;
  initiatorType: "fetch" | "xmlhttprequest";
  duration: number;
  transferSize: number;
}

export interface CodexRuntimeStatus {
  available: boolean;
  command?: string;
  authenticated: boolean;
  authMode: "chatgpt" | "apikey" | null;
  error?: string;
}

export interface AgentRuntimeStatus {
  id: "codex" | "openai";
  name: string;
  available: boolean;
  authenticated: boolean;
  model?: string;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
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
  context?: { selectedElement?: InspectedElement };
  elements: PageElementSnapshot[];
  performance: PerformanceSnapshot;
}

export interface BrowserActionStep {
  action: BrowserActionKind;
  targetRef?: string;
  value?: string;
  direction?: "up" | "down" | "left" | "right" | "top" | "bottom";
  amountPx?: number;
  reason: string;
}

export interface BrowserActionPlan {
  kind: "action_plan";
  summary: string;
  snapshotId: string;
  requiresConfirmation: boolean;
  confidence: number;
  steps: BrowserActionStep[];
}

export interface AgentAnswer {
  kind: "answer";
  content: string;
}

export type AgentDecision = BrowserActionPlan | AgentAnswer;
