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
  contentEditable: boolean;
  viewportRect: ViewportRect;
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
  | { id: string; type: "agent.run"; task: string; snapshot: PageSnapshot };

export type ServerMessage =
  | { id: string; type: "health.result"; ok: boolean; provider: string }
  | { id: string; type: "agent.result"; decision: AgentDecision }
  | { id: string; type: "agent.error"; error: string };
