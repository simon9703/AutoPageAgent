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
  source?: {
    component?: string;
    file?: string;
    repository?: string;
    // TODO(i18n): Add i18nKey when translation-catalog correlation enters scope.
  };
}

// TODO(i18n): Extend with an "i18n" evidence kind when translation analysis is implemented.
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
  summary: {
    requestCount: number;
    totalTransferSize: number;
    slowRequestCount: number;
  };
}

export interface PageSnapshot {
  snapshotId: string;
  url: string;
  title: string;
  language: string;
  selectedText: string;
  headings: Array<{ level: number; text: string }>;
  mainText: string;
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

export type ClientMessage =
  | { id: string; type: "health.check" }
  | { id: string; type: "agent.run"; task: string; snapshot: PageSnapshot }
  | { id: string; type: "repository.analyze"; pageUrl: string; element: InspectedElement };

export type ServerMessage =
  | { id: string; type: "health.result"; ok: boolean; provider: string; repositories: string[] }
  | { id: string; type: "agent.result"; decision: AgentDecision }
  | { id: string; type: "repository.result"; analysis: RepositoryAnalysis }
  | { id: string; type: "agent.error"; error: string };
