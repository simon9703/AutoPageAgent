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
