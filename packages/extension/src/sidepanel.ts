import type { BrowserActionPlan, InspectedElement, RepositoryAnalysis, ServerMessage } from "@auto-page-agent/shared";

const status = document.querySelector<HTMLSpanElement>("#status")!;
const result = document.querySelector<HTMLElement>("#result")!;
const approval = document.querySelector<HTMLElement>("#approval")!;
const steps = document.querySelector<HTMLOListElement>("#steps")!;
const task = document.querySelector<HTMLTextAreaElement>("#task")!;
const run = document.querySelector<HTMLButtonElement>("#run")!;
let pendingPlan: BrowserActionPlan | null = null;
let selectedElement: InspectedElement | null = null;
let selectedElementPageUrl = "";

void checkHealth();
void restoreSelectedElement();
document.querySelectorAll<HTMLButtonElement>("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => { task.value = button.dataset.prompt ?? ""; task.focus(); });
});
document.querySelector<HTMLFormElement>("#composer")!.addEventListener("submit", (event) => {
  event.preventDefault();
  void runTask();
});
document.querySelector("#cancel")!.addEventListener("click", () => hideApproval());
document.querySelector("#execute")!.addEventListener("click", () => void executePlan());
document.querySelector("#pick-element")!.addEventListener("click", () => void startElementSelection());
document.querySelector("#analyze-code")!.addEventListener("click", () => void analyzeCode());
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "ui.element.selected") showSelectedElement(message.element as InspectedElement, String(message.pageUrl ?? ""));
});

async function checkHealth() {
  const response = await chrome.runtime.sendMessage({ type: "ui.health" }) as ServerMessage;
  if (response.type === "health.result" && response.ok) {
    status.textContent = response.provider;
    if (response.repositories.length) status.title = `Repositories: ${response.repositories.join(", ")}`;
    status.classList.add("online");
  } else {
    status.textContent = "Bridge offline";
  }
}

async function restoreSelectedElement() {
  const stored = await chrome.runtime.sendMessage({ type: "ui.selection.current" }) as { selectedElement?: InspectedElement; selectedElementPageUrl?: string };
  if (stored.selectedElement) showSelectedElement(stored.selectedElement, stored.selectedElementPageUrl ?? "");
}

async function startElementSelection() {
  const response = await chrome.runtime.sendMessage({ type: "ui.selection.start" });
  if (response?.error) return render(`Selection error: ${response.error}`);
  render("Move over the page and click the element you want to inspect. Press Escape to cancel.");
}

function showSelectedElement(element: InspectedElement, pageUrl: string) {
  selectedElement = element;
  selectedElementPageUrl = pageUrl;
  document.querySelector<HTMLElement>("#element-tag")!.textContent = element.tagName;
  document.querySelector<HTMLElement>("#element-summary")!.textContent = element.label || element.text || element.nearbyText || "No visible text";
  document.querySelector<HTMLElement>("#element-card")!.classList.remove("hidden");
  render(`Selected <${element.tagName}>. Search configured local repositories for source and API evidence.`);
}

async function analyzeCode() {
  if (!selectedElement) return;
  const response = await chrome.runtime.sendMessage({ type: "ui.repository.analyze", element: selectedElement, pageUrl: selectedElementPageUrl }) as ServerMessage;
  if (response.type === "agent.error") return render(`Repository analysis error: ${response.error}`);
  if (response.type !== "repository.result") return render("Unexpected repository response.");
  renderRepositoryAnalysis(response.analysis);
}

function renderRepositoryAnalysis(analysis: RepositoryAnalysis) {
  const evidence = analysis.evidence.map((item, index) => [
    `${index + 1}. [${item.confidence}/${item.kind}] ${item.repository}/${item.path}:${item.line}`,
    `   matched “${item.matchedTerm}” — ${item.preview}`,
  ].join("\n")).join("\n\n");
  render([
    `Repositories: ${analysis.repositories.join(", ") || "none configured"}`,
    `Query terms: ${analysis.queryTerms.join(" | ") || "none"}`,
    analysis.warnings.length ? `Warnings: ${analysis.warnings.join(" ")}` : "",
    evidence || "No repository evidence found.",
  ].filter(Boolean).join("\n\n"));
}

async function runTask() {
  setBusy(true);
  hideApproval();
  render("Reading the current page and asking the agent…");
  const response = await chrome.runtime.sendMessage({ type: "ui.run", task: task.value }) as ServerMessage;
  setBusy(false);
  if (response.type === "agent.error") return render(`Error: ${response.error}`);
  if (response.type !== "agent.result") return render("Unexpected bridge response.");
  if (response.decision.kind === "answer") return render(response.decision.content);
  pendingPlan = response.decision;
  render(`${response.decision.summary}\n\nConfidence: ${Math.round(response.decision.confidence * 100)}%`);
  steps.replaceChildren(...response.decision.steps.map((step) => {
    const item = document.createElement("li");
    item.textContent = `${step.action} ${step.targetRef ?? "page"}: ${step.reason}`;
    return item;
  }));
  approval.classList.remove("hidden");
}

async function executePlan() {
  if (!pendingPlan) return;
  approval.classList.add("hidden");
  const response = await chrome.runtime.sendMessage({ type: "ui.execute", plan: pendingPlan });
  render(response?.ok ? "Actions completed. The page may have changed; run another task to continue." : `Action failed: ${response?.error ?? "Unknown error"}`);
  pendingPlan = null;
}

function hideApproval() { approval.classList.add("hidden"); pendingPlan = null; }
function setBusy(value: boolean) { run.disabled = value; run.textContent = value ? "Working…" : "Run agent"; }
function render(text: string) { result.textContent = text; result.classList.remove("empty"); }
