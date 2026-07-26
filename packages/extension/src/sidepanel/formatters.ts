import type { AgentEvent, RepositoryAnalysis } from "@auto-page-agent/shared";
import type { TFunction } from "i18next";

export function eventLabel(event: AgentEvent, t: TFunction): string {
  if (event.type === "action") {
    return `${event.status === "running" ? t("agent.actionRunning") : t("agent.action")} · ${event.action}${event.detail ? ` · ${event.detail}` : ""}`;
  }
  if (event.type === "verify") return `${t("agent.verify")} · ${event.summary}`;
  if (event.type === "complete") return `${t("agent.complete")} · ${event.summary}`;
  return `${t("agent.error")} · ${event.error}`;
}

export function formatRepositoryAnalysis(analysis: RepositoryAnalysis, t: TFunction) {
  const evidence = analysis.evidence
    .map((item, index) => `${index + 1}. [${item.confidence}/${item.kind}] ${item.repository}/${item.path}:${item.line}\n   ${item.preview}`)
    .join("\n\n");
  return [
    t("repository.repositories", { value: analysis.repositories.join(", ") || t("repository.noneConfigured") }),
    analysis.warnings.length ? t("repository.warnings", { value: analysis.warnings.join(" ") }) : "",
    evidence || t("repository.noEvidence"),
  ].filter(Boolean).join("\n\n");
}

export function defaultSkillName(url: string, t: TFunction) {
  try {
    return t("recording.defaultName", { hostname: new URL(url).hostname });
  } catch {
    return t("recording.fallbackName");
  }
}

export function hostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
