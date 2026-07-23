export * from "./agent-events.js";
import type { AgentEvent } from "./agent-events.js";

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
  expanded?: boolean;
  busy?: boolean;
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

export type RecordedActionKind = "click" | "fill" | "select" | "scroll" | "submit";

export interface RecordedBrowserAction {
  id: string;
  action: RecordedActionKind;
  url: string;
  selector?: string;
  label?: string;
  value?: string;
  sensitive: boolean;
  timestamp: number;
  scrollX?: number;
  scrollY?: number;
}

export interface AutomationSkillDraft {
  name: string;
  description: string;
  startUrl: string;
  createdAt: string;
  requiresConfirmation: true;
  steps: RecordedBrowserAction[];
}

export type SkillCategory = "productivity" | "release" | "translation" | "page" | "custom";

export interface SkillCatalogItem {
  name: string;
  slug: string;
  description: string;
  category: SkillCategory;
  version: string;
  installed: boolean;
  updateAvailable: boolean;
  source: "marketplace" | "custom";
  scope: "page" | "global";
  pagePatterns: string[];
  stepCount: number;
  variableNames: string[];
  updatedAt?: string;
}

export interface EditableAutomationSkill {
  name: string;
  slug: string;
  description: string;
  category: SkillCategory;
  version: string;
  startUrl?: string;
  enabled: boolean;
  pagePatterns: string[];
  steps: RecordedBrowserAction[];
}

export interface SavedAutomationSkill {
  name: string;
  slug: string;
  skillPath: string;
  workflowPath: string;
  variableNames: string[];
  operation: "created" | "updated";
  version: string;
}

export interface PageSkillSummary {
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  configurable: boolean;
  scope: "page" | "global";
  match: "origin" | "path-prefix" | "wildcard" | "global";
  pagePattern?: string;
  pagePatterns: string[];
  stepCount: number;
  actions: RecordedActionKind[];
  variableNames: string[];
}

export interface ConfiguredAutomationSkill {
  slug: string;
  enabled: boolean;
  pagePatterns: string[];
}

export interface SkillSelection {
  name: string;
  slug: string;
  reason: string;
  score: number;
  scope: "page" | "global";
  body: string;
}

export interface AgentLoopContext {
  runId: string;
  iteration: number;
  maxSteps: number;
  timeoutMs: number;
  startedAt: number;
  previousSnapshot?: PageSnapshot;
  lastAction?: BrowserActionStep;
  lastVerification?: ActionVerification;
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

export type ClientMessage =
  | { id: string; type: "health.check" }
  | { id: string; type: "agent.reset"; conversationId: string }
  | { id: string; type: "agent.run"; task: string; snapshot: PageSnapshot; conversationId: string; history: ChatMessage[]; loop?: AgentLoopContext }
  | { id: string; type: "repository.analyze"; pageUrl: string; element: InspectedElement; apiRequests: ApiRequestSnapshot[] }
  | { id: string; type: "skill.list"; pageUrl: string; pageTitle: string }
  | { id: string; type: "skill.catalog" }
  | { id: string; type: "skill.get"; slug: string }
  | { id: string; type: "skill.install"; slug: string }
  | { id: string; type: "skill.configure"; slug: string; enabled?: boolean; pagePatterns?: string[] }
  | { id: string; type: "skill.save"; draft: AutomationSkillDraft; existingSlug?: string };

export type ServerMessage =
  | { id: string; type: "health.result"; ok: boolean; provider: string; repositories: string[]; codex: CodexRuntimeStatus; agent: AgentRuntimeStatus }
  | { id: string; type: "agent.reset.result"; conversationId: string }
  | { id: string; type: "agent.event"; event: AgentEvent }
  | { id: string; type: "agent.result"; decision: AgentDecision; provider: string; conversationId: string; selectedSkills: Omit<SkillSelection, "body">[] }
  | { id: string; type: "repository.result"; analysis: RepositoryAnalysis }
  | { id: string; type: "skill.list.result"; pageUrl: string; skills: PageSkillSummary[] }
  | { id: string; type: "skill.catalog.result"; installed: SkillCatalogItem[]; marketplace: SkillCatalogItem[]; storagePath: string }
  | { id: string; type: "skill.detail"; skill: EditableAutomationSkill }
  | { id: string; type: "skill.installed"; skill: SkillCatalogItem }
  | { id: string; type: "skill.configured"; skill: ConfiguredAutomationSkill }
  | { id: string; type: "skill.saved"; skill: SavedAutomationSkill }
  | { id: string; type: "agent.error"; error: string };
