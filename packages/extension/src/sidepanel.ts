import type { BrowserActionPlan, ServerMessage } from "@auto-page-agent/shared";

const status = document.querySelector<HTMLSpanElement>("#status")!;
const result = document.querySelector<HTMLElement>("#result")!;
const approval = document.querySelector<HTMLElement>("#approval")!;
const steps = document.querySelector<HTMLOListElement>("#steps")!;
const task = document.querySelector<HTMLTextAreaElement>("#task")!;
const run = document.querySelector<HTMLButtonElement>("#run")!;
let pendingPlan: BrowserActionPlan | null = null;

void checkHealth();
document.querySelectorAll<HTMLButtonElement>("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => { task.value = button.dataset.prompt ?? ""; task.focus(); });
});
document.querySelector<HTMLFormElement>("#composer")!.addEventListener("submit", (event) => {
  event.preventDefault();
  void runTask();
});
document.querySelector("#cancel")!.addEventListener("click", () => hideApproval());
document.querySelector("#execute")!.addEventListener("click", () => void executePlan());

async function checkHealth() {
  const response = await chrome.runtime.sendMessage({ type: "ui.health" }) as ServerMessage;
  if (response.type === "health.result" && response.ok) {
    status.textContent = response.provider;
    status.classList.add("online");
  } else {
    status.textContent = "Bridge offline";
  }
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
