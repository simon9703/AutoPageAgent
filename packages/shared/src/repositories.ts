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
