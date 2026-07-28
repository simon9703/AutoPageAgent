import type { ActionVerification, BrowserActionStep } from "./browser.js";

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

export interface AgentComplete {
  kind: "complete";
  summary: string;
  evidence: string[];
}

export interface AgentBlocked {
  kind: "blocked";
  reason: string;
  recoverable: boolean;
  code?: "completion_evidence_missing";
  unmatchedEvidence?: string[];
}

export interface AgentNeedsUser {
  kind: "needs_user";
  question: string;
  options?: string[];
  recommendedOption?: string;
}

export type AgentDecision =
  | BrowserActionPlan
  | AgentAnswer
  | AgentComplete
  | AgentBlocked
  | AgentNeedsUser;

export interface AgentLoopContext {
  runId: string;
  iteration: number;
  maxSteps: number;
  timeoutMs: number;
  startedAt: number;
  lastAction?: BrowserActionStep;
  lastVerification?: ActionVerification;
  remainingPlan?: Array<{
    action: BrowserActionStep["action"];
    reason: string;
  }>;
  reobserve?: {
    reason: "page_url_changed" | "page_context_changed" | "page_content_changed" | "snapshot_expired" | "page_context_invalidated";
    summary: string;
    actionMayHaveExecuted: boolean;
  };
  visualRecovery?: {
    reason: "viewport_screenshot";
    summary: string;
  };
  completionEvidenceFailure?: {
    reason: string;
    unmatchedEvidence: string[];
  };
}
