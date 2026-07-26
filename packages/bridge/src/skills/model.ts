import type { RecordedBrowserAction, SkillCategory } from "@auto-page-agent/shared";

export interface LoadedWorkflow {
  schemaVersion?: number;
  enabled?: boolean;
  startUrl?: string;
  pagePatterns?: string[];
  instructions?: string;
  steps?: Array<Partial<RecordedBrowserAction> & { value?: string }>;
}

export interface LoadedSkill {
  name: string;
  slug: string;
  description: string;
  body: string;
  workflow?: LoadedWorkflow;
  category: SkillCategory;
  version: string;
  updatedAt?: string;
}
