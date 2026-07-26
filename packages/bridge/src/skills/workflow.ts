import type { AutomationSkillDraft, RecordedActionKind, RecordedBrowserAction, SkillCategory } from "@auto-page-agent/shared";
import { defaultPagePattern, safeHttpUrl } from "./page-patterns.js";
import { cleanSingleLine, finiteCoordinate, uniqueVariableName } from "./utils.js";

export function renderSkillMarkdown(
  draft: AutomationSkillDraft,
  variableNames: string[],
  metadata: { category?: SkillCategory; version?: string } = {},
): string {
  const description = cleanSingleLine(draft.description || `Replay the recorded ${draft.name} browser workflow.`, 240);
  return [
    "---",
    `name: ${cleanSingleLine(draft.name, 80)}`,
    `description: ${description}`,
    `category: ${metadata.category ?? "custom"}`,
    `version: ${metadata.version ?? "1.0.0"}`,
    "---",
    "",
    `# ${cleanSingleLine(draft.name, 80)}`,
    "",
    ...(draft.instructions?.trim()
      ? ["## Instructions", "", draft.instructions.trim().slice(0, 20_000), ""]
      : []),
    "Use this Skill only when the active page matches the configured start URL. Inspect the page again if a selector is missing.",
    "",
    "## Safety",
    "",
    "- Ask for confirmation before replaying the workflow.",
    "- Never fill password, payment, token, OTP, file, or credential fields.",
    "- Stop before an irreversible, destructive, purchase, or final-submit action unless the user explicitly confirms it.",
    "- Treat `workflow.json` selectors as hints and revalidate targets against the current page.",
    "",
    "## Inputs",
    "",
    ...(variableNames.length ? variableNames.map((name) => `- \`${name}\`: value requested from the user at run time.`) : ["- No recorded text inputs."]),
    "",
    "## Workflow",
    "",
    "Read `workflow.json`, resolve its variables, create a constrained browser action plan, and show the plan for confirmation before execution.",
    "",
    "<!-- TODO(i18n): Add localized labels and locale matching only when i18n support is enabled. -->",
    "",
  ].join("\n");
}

export function parameterizeWorkflow(draft: AutomationSkillDraft) {
  const variableNames: string[] = [];
  let fieldIndex = 0;
  const steps = draft.steps.map((step) => {
    const clean = sanitizeRecordedStep(step);
    if ((clean.action === "fill" || clean.action === "select") && !clean.sensitive) {
      fieldIndex += 1;
      const variable = uniqueVariableName(clean.label, fieldIndex, variableNames);
      variableNames.push(variable);
      return { ...clean, value: `{{${variable}}}` };
    }
    return { ...clean, value: undefined };
  });
  return {
    variableNames,
    document: {
      schemaVersion: 2,
      name: draft.name,
      description: draft.description,
      startUrl: safeHttpUrl(draft.startUrl),
      enabled: true,
      pagePatterns: [defaultPagePattern(safeHttpUrl(draft.startUrl))],
      createdAt: draft.createdAt,
      requiresConfirmation: true,
      ...(draft.instructions?.trim() ? { instructions: draft.instructions.trim().slice(0, 20_000) } : {}),
      steps,
    },
  };
}

function sanitizeRecordedStep(step: RecordedBrowserAction): RecordedBrowserAction {
  if (!["click", "fill", "select", "scroll", "submit", "navigate"].includes(step.action)) throw new Error("Recorded Skill contains an unsupported action.");
  const url = safeHttpUrl(step.url);
  const selector = step.selector ? cleanSingleLine(step.selector, 500) : undefined;
  if (!["scroll", "navigate"].includes(step.action) && !selector) throw new Error(`Recorded ${step.action} step is missing a selector.`);
  return {
    id: cleanSingleLine(step.id, 100) || crypto.randomUUID(),
    action: step.action,
    url,
    selector,
    label: step.label ? cleanSingleLine(step.label, 160) : undefined,
    sensitive: Boolean(step.sensitive),
    timestamp: Number.isFinite(step.timestamp) ? step.timestamp : Date.now(),
    ...(step.action === "scroll" ? { scrollX: finiteCoordinate(step.scrollX), scrollY: finiteCoordinate(step.scrollY) } : {}),
    ...(typeof step.checked === "boolean" ? { checked: step.checked } : {}),
  };
}

export function isEditableStep(step: Partial<RecordedBrowserAction>): step is Partial<RecordedBrowserAction> & { action: RecordedActionKind } {
  return typeof step.action === "string" && ["click", "fill", "select", "scroll", "submit", "navigate"].includes(step.action);
}
