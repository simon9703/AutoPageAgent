import type { AgentEvent, RepositoryAnalysis } from "@auto-page-agent/shared";

export function eventLabel(event: AgentEvent): string {
  if (event.type === "observe") return `Observe · ${event.summary || event.snapshotId}`;
  if (event.type === "thinking") {
    return event.delta
      ? `Thinking · ${event.content.replace(/\s+/gu, " ").slice(0, 120)}`
      : event.content;
  }
  if (event.type === "plan") return `Plan · ${event.summary}`;
  if (event.type === "action") {
    return `${event.status === "running" ? "Act" : "Action"} · ${event.action}${event.detail ? ` · ${event.detail}` : ""}`;
  }
  if (event.type === "verify") return `Verify · ${event.summary}`;
  if (event.type === "complete") return `Complete · ${event.summary}`;
  return `Error · ${event.error}`;
}

export function formatRepositoryAnalysis(analysis: RepositoryAnalysis) {
  const evidence = analysis.evidence
    .map((item, index) => `${index + 1}. [${item.confidence}/${item.kind}] ${item.repository}/${item.path}:${item.line}\n   ${item.preview}`)
    .join("\n\n");
  return [
    `Repositories: ${analysis.repositories.join(", ") || "none configured"}`,
    analysis.warnings.length ? `Warnings: ${analysis.warnings.join(" ")}` : "",
    evidence || "No repository evidence found.",
  ].filter(Boolean).join("\n\n");
}

export function defaultSkillName(url: string) {
  try {
    return `${new URL(url).hostname} workflow`;
  } catch {
    return "Recorded browser workflow";
  }
}

export function hostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
