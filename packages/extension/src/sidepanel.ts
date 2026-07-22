import type { AutomationSkillDraft, BrowserActionPlan, ChatMessage, InspectedElement, PageSkillSummary, RecordedBrowserAction, RepositoryAnalysis, ServerMessage } from "@auto-page-agent/shared";

const status = document.querySelector<HTMLSpanElement>("#status")!;
const result = document.querySelector<HTMLElement>("#result")!;
const approval = document.querySelector<HTMLElement>("#approval")!;
const steps = document.querySelector<HTMLOListElement>("#steps")!;
const task = document.querySelector<HTMLTextAreaElement>("#task")!;
const run = document.querySelector<HTMLButtonElement>("#run")!;
let pendingPlan: BrowserActionPlan | null = null;
let selectedElement: InspectedElement | null = null;
let selectedElementPageUrl = "";
let recordingActive = false;
let recordedActions: RecordedBrowserAction[] = [];
let recordingStartUrl = "";
let conversationId: string = crypto.randomUUID();
let chatMessages: ChatMessage[] = [];

void checkHealth();
void restoreSelectedElement();
void restoreRecording();
void loadPageSkills();
void restoreConversation();
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
document.querySelector("#pick-image")!.addEventListener("click", () => void startElementSelection("image"));
document.querySelector("#analyze-code")!.addEventListener("click", () => void analyzeCode());
document.querySelector("#capture-screenshot")!.addEventListener("click", () => void captureScreenshot());
document.querySelector("#close-screenshot")!.addEventListener("click", () => document.querySelector("#screenshot-card")!.classList.add("hidden"));
document.querySelector("#toggle-recording")!.addEventListener("click", () => void toggleRecording());
document.querySelector("#replay-recording")!.addEventListener("click", () => void replayRecording());
document.querySelector("#save-skill")!.addEventListener("click", () => void saveSkill());
document.querySelector("#refresh-skills")!.addEventListener("click", () => void loadPageSkills());
document.querySelector("#new-chat")!.addEventListener("click", () => void startNewConversation());
document.querySelector("#page-skills")!.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-skill-action]") : null;
  if (!button) return;
  const action = button.dataset.skillAction;
  const name = button.dataset.skillName ?? "";
  const description = button.dataset.skillDescription ?? "";
  if (action === "use") {
    task.value = `Use the “${name}” Skill on the current page. ${description}`.trim();
    task.focus();
    render(`Selected page Skill: ${name}. Review or add inputs, then run the agent.`);
  }
  if (action === "toggle") void configurePageSkill(button.dataset.skillSlug ?? "", { enabled: button.dataset.skillEnabled !== "true" });
  if (action === "patterns") {
    const current = button.dataset.skillPatterns ?? "";
    const entered = prompt("Page URL patterns (one per line). The origin must be fixed; * and ** are allowed only in paths.", current);
    if (entered !== null) void configurePageSkill(button.dataset.skillSlug ?? "", { pagePatterns: entered.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean) });
  }
});
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "ui.element.selected") showSelectedElement(message.element as InspectedElement, String(message.pageUrl ?? ""));
  if (message?.type === "ui.recording.updated") {
    recordedActions = message.actions as RecordedBrowserAction[];
    renderRecording();
  }
  if (message?.type === "ui.page.changed") void loadPageSkills();
});

async function checkHealth() {
  const response = await chrome.runtime.sendMessage({ type: "ui.health" }) as ServerMessage;
  if (response.type === "health.result") {
    status.textContent = response.ok ? response.agent.name : response.agent.error ? "Agent unavailable" : "Bridge online";
    status.title = [response.agent.model ? `Model: ${response.agent.model}` : "", response.agent.error ?? "", response.codex.command ?? "", response.repositories.length ? `Repositories: ${response.repositories.join(", ")}` : ""].filter(Boolean).join("\n");
    status.classList.toggle("online", response.ok);
  } else {
    status.textContent = "Bridge offline";
  }
}

async function restoreConversation() {
  const stored = await chrome.storage.session.get(["conversationId", "chatMessages"]);
  conversationId = typeof stored.conversationId === "string" ? stored.conversationId : conversationId;
  chatMessages = Array.isArray(stored.chatMessages) ? (stored.chatMessages as ChatMessage[]).slice(-40) : [];
  renderConversation();
}

async function startNewConversation() {
  conversationId = crypto.randomUUID();
  chatMessages = [];
  hideApproval();
  await persistConversation();
  renderConversation();
  render("New conversation started. Page selection is kept as context until another element is selected.");
}

async function persistConversation() {
  await chrome.storage.session.set({ conversationId, chatMessages: chatMessages.slice(-40) });
}

function appendChat(role: ChatMessage["role"], content: string, provider?: string) {
  chatMessages.push({ id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString() });
  if (chatMessages.length > 40) chatMessages = chatMessages.slice(-40);
  renderConversation(provider);
  void persistConversation();
}

function renderConversation(provider?: string) {
  const thread = document.querySelector<HTMLElement>("#chat-thread")!;
  if (!chatMessages.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = "Select page context or send a message to start.";
    thread.replaceChildren(empty);
    return;
  }
  thread.replaceChildren(...chatMessages.map((message, index) => {
    const bubble = document.createElement("article");
    bubble.className = `chat-message ${message.role}`;
    bubble.textContent = message.content;
    if (provider && index === chatMessages.length - 1 && message.role === "assistant") {
      const meta = document.createElement("small");
      meta.textContent = provider;
      bubble.append(meta);
    }
    return bubble;
  }));
  thread.scrollTop = thread.scrollHeight;
}

async function restoreSelectedElement() {
  const stored = await chrome.runtime.sendMessage({ type: "ui.selection.current" }) as { selectedElement?: InspectedElement; selectedElementPageUrl?: string };
  if (stored.selectedElement) showSelectedElement(stored.selectedElement, stored.selectedElementPageUrl ?? "");
}

async function restoreRecording() {
  const state = await chrome.runtime.sendMessage({ type: "ui.recording.status" }) as { active?: boolean; startUrl?: string; actions?: RecordedBrowserAction[] };
  recordingActive = Boolean(state.active);
  recordingStartUrl = state.startUrl ?? "";
  recordedActions = state.actions ?? [];
  updateRecordingButton();
  if (recordingActive || recordedActions.length) renderRecording();
}

async function loadPageSkills() {
  const scope = document.querySelector<HTMLElement>("#page-scope")!;
  const container = document.querySelector<HTMLElement>("#page-skills")!;
  scope.textContent = "Loading current-page functions…";
  const response = await chrome.runtime.sendMessage({ type: "ui.skills.list" }) as ServerMessage;
  if (response.type === "agent.error") {
    scope.textContent = "Skill discovery unavailable";
    container.replaceChildren(createHint(response.error));
    return;
  }
  if (response.type !== "skill.list.result") {
    scope.textContent = "Unexpected Skill response";
    return;
  }
  try { scope.textContent = `${new URL(response.pageUrl).hostname} · ${response.skills.length} available`; }
  catch { scope.textContent = `${response.skills.length} available`; }
  if (!response.skills.length) {
    container.replaceChildren(createHint("No Skill matches this page. Record a workflow to create one."));
    return;
  }
  container.replaceChildren(...response.skills.map(createSkillItem));
}

function createSkillItem(skill: PageSkillSummary): HTMLElement {
  const item = document.createElement("article");
  item.className = `skill-item${skill.enabled ? "" : " disabled"}`;
  const title = document.createElement("strong");
  title.textContent = skill.name;
  const controls = document.createElement("div");
  controls.className = "skill-controls";
  const use = document.createElement("button");
  use.className = "compact";
  use.textContent = "Use";
  use.disabled = !skill.enabled;
  use.dataset.skillAction = "use";
  use.dataset.skillName = skill.name;
  use.dataset.skillDescription = skill.description;
  controls.append(use);
  if (skill.configurable) {
    const toggle = document.createElement("button");
    toggle.className = "compact";
    toggle.textContent = skill.enabled ? "Disable" : "Enable";
    toggle.dataset.skillAction = "toggle";
    toggle.dataset.skillSlug = skill.slug;
    toggle.dataset.skillEnabled = String(skill.enabled);
    const patterns = document.createElement("button");
    patterns.className = "compact";
    patterns.textContent = "Match";
    patterns.dataset.skillAction = "patterns";
    patterns.dataset.skillSlug = skill.slug;
    patterns.dataset.skillPatterns = skill.pagePatterns.join("\n");
    controls.append(toggle, patterns);
  }
  const badge = document.createElement("span");
  badge.className = `scope-badge ${skill.enabled ? skill.scope : "disabled"}`;
  badge.textContent = skill.enabled ? skill.scope === "page" ? "Page" : "Global" : "Disabled";
  const meta = document.createElement("small");
  meta.textContent = skill.stepCount
    ? `${skill.stepCount} steps · ${skill.actions.join(" / ")}${skill.variableNames.length ? ` · inputs: ${skill.variableNames.join(", ")}` : ""}`
    : "General page capability";
  const description = document.createElement("p");
  description.textContent = skill.description || skill.pagePattern || "Reusable browser capability";
  item.append(title, controls, badge, meta, description);
  return item;
}

async function configurePageSkill(slug: string, changes: { enabled?: boolean; pagePatterns?: string[] }) {
  if (!slug) return render("Skill configuration error: missing Skill identifier.");
  const response = await chrome.runtime.sendMessage({ type: "ui.skill.configure", slug, ...changes }) as ServerMessage;
  if (response.type === "agent.error") return render(`Skill configuration error: ${response.error}`);
  if (response.type !== "skill.configured") return render("Unexpected Skill configuration response.");
  render(`Skill updated: ${response.skill.slug}\nStatus: ${response.skill.enabled ? "enabled" : "disabled"}\nMatches: ${response.skill.pagePatterns.join("\n")}`);
  await loadPageSkills();
}

function createHint(text: string): HTMLElement {
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = text;
  return hint;
}

async function captureScreenshot() {
  render("Capturing the current viewport…");
  const response = await chrome.runtime.sendMessage({ type: "ui.screenshot.capture" }) as { ok?: boolean; dataUrl?: string; title?: string; url?: string; capturedAt?: string; error?: string };
  if (!response.ok || !response.dataUrl) return render(`Screenshot error: ${response.error ?? "Capture failed."}`);
  const preview = document.querySelector<HTMLImageElement>("#screenshot-preview")!;
  preview.src = response.dataUrl;
  document.querySelector<HTMLElement>("#screenshot-meta")!.textContent = `${response.title || "Current page"}\n${response.url || ""}\n${response.capturedAt || ""}`;
  document.querySelector("#screenshot-card")!.classList.remove("hidden");
  render("Screenshot captured locally. It has not been sent to Codex or saved to disk.");
}

async function toggleRecording() {
  if (!recordingActive) {
    const state = await chrome.runtime.sendMessage({ type: "ui.recording.start" }) as { active?: boolean; startUrl?: string; actions?: RecordedBrowserAction[]; error?: string };
    if (state.error) return render(`Recording error: ${state.error}`);
    recordingActive = true;
    recordingStartUrl = state.startUrl ?? "";
    recordedActions = [];
    document.querySelector<HTMLInputElement>("#skill-name")!.value = defaultSkillName(recordingStartUrl);
    updateRecordingButton();
    renderRecording();
    return render("Recording started. Use the page normally, then click Stop recording.");
  }
  const state = await chrome.runtime.sendMessage({ type: "ui.recording.stop" }) as { startUrl?: string; actions?: RecordedBrowserAction[]; error?: string };
  if (state.error) return render(`Recording error: ${state.error}`);
  recordingActive = false;
  recordingStartUrl = state.startUrl ?? recordingStartUrl;
  recordedActions = state.actions ?? recordedActions;
  updateRecordingButton();
  renderRecording();
  render(`Recording stopped with ${recordedActions.length} step(s). Review, test, or save it as a Skill.`);
}

function updateRecordingButton() {
  const button = document.querySelector<HTMLButtonElement>("#toggle-recording")!;
  button.textContent = recordingActive ? "Stop recording" : "Record workflow";
  button.classList.toggle("recording", recordingActive);
}

function renderRecording() {
  const card = document.querySelector<HTMLElement>("#recording-card")!;
  card.classList.remove("hidden");
  document.querySelector<HTMLElement>("#recording-title")!.textContent = recordingActive ? "Recording in progress" : "Recorded workflow";
  document.querySelector<HTMLElement>("#recording-count")!.textContent = `${recordedActions.length} steps`;
  const list = document.querySelector<HTMLOListElement>("#recorded-steps")!;
  list.replaceChildren(...recordedActions.map((step) => {
    const item = document.createElement("li");
    const value = step.sensitive ? " [manual sensitive input]" : step.value ? ` = ${truncate(step.value, 40)}` : "";
    item.textContent = `${step.action} ${step.label || step.selector || "page"}${value}`;
    return item;
  }));
}

async function replayRecording() {
  if (!recordedActions.length) return render("Record at least one action first.");
  if (!confirm(`Replay ${recordedActions.length} recorded action(s) on the current page?`)) return;
  const response = await chrome.runtime.sendMessage({ type: "ui.recording.replay", actions: recordedActions }) as { ok?: boolean; error?: string };
  render(response.ok ? "Recorded workflow replay completed." : `Replay stopped: ${response.error ?? "Unknown error"}`);
}

async function saveSkill() {
  if (recordingActive) return render("Stop recording before saving the Skill.");
  if (!recordedActions.length) return render("Record at least one action first.");
  const name = document.querySelector<HTMLInputElement>("#skill-name")!.value.trim();
  const description = document.querySelector<HTMLTextAreaElement>("#skill-description")!.value.trim();
  if (!name) return render("Enter a Skill name.");
  const draft: AutomationSkillDraft = {
    name,
    description: description || `Replay the recorded ${name} browser workflow.`,
    startUrl: recordingStartUrl || recordedActions[0]!.url,
    createdAt: new Date().toISOString(),
    requiresConfirmation: true,
    steps: recordedActions,
  };
  const response = await chrome.runtime.sendMessage({ type: "ui.skill.save", draft }) as ServerMessage;
  if (response.type === "agent.error") return render(`Skill save error: ${response.error}`);
  if (response.type !== "skill.saved") return render("Unexpected Skill save response.");
  render(`Skill saved: ${response.skill.skillPath}\nWorkflow: ${response.skill.workflowPath}\nRuntime inputs: ${response.skill.variableNames.join(", ") || "none"}`);
  await loadPageSkills();
}

function defaultSkillName(url: string) {
  try { return `${new URL(url).hostname} workflow`; } catch { return "Recorded browser workflow"; }
}

function truncate(value: string, max: number) { return value.length > max ? `${value.slice(0, max)}…` : value; }

async function startElementSelection(mode: "element" | "image" = "element") {
  const response = await chrome.runtime.sendMessage({ type: "ui.selection.start", mode });
  if (response?.error) return render(`Selection error: ${response.error}`);
  render(mode === "image" ? "Move over the page and click an image. Press Escape to cancel." : "Move over the page and click the element you want to inspect. Press Escape to cancel.");
}

function showSelectedElement(element: InspectedElement, pageUrl: string) {
  selectedElement = element;
  selectedElementPageUrl = pageUrl;
  document.querySelector<HTMLElement>("#element-tag")!.textContent = element.tagName;
  document.querySelector<HTMLElement>("#element-summary")!.textContent = element.label || element.text || element.nearbyText || "No visible text";
  const image = document.querySelector<HTMLImageElement>("#selected-image")!;
  if (element.image?.src) {
    image.src = element.image.src;
    image.alt = element.image.alt || "Selected page image";
    image.classList.remove("hidden");
  } else {
    image.removeAttribute("src");
    image.classList.add("hidden");
  }
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
  const userText = task.value.trim();
  if (!userText) return render("Enter a message first.");
  const history = chatMessages.slice(-20);
  appendChat("user", userText);
  task.value = "";
  setBusy(true);
  hideApproval();
  render("Reading the simplified page DOM and asking the agent…");
  const response = await chrome.runtime.sendMessage({ type: "ui.run", task: userText, conversationId, history }) as ServerMessage;
  setBusy(false);
  if (response.type === "agent.error") {
    appendChat("assistant", `Error: ${response.error}`);
    return render(`Error: ${response.error}`);
  }
  if (response.type !== "agent.result") return render("Unexpected bridge response.");
  if (response.decision.kind === "answer") {
    appendChat("assistant", response.decision.content, response.provider);
    return render(`Answered by ${response.provider}.`);
  }
  pendingPlan = response.decision;
  appendChat("assistant", `${response.decision.summary}\n\nProposed ${response.decision.steps.length} browser action(s).`, response.provider);
  render(`Plan from ${response.provider} · confidence ${Math.round(response.decision.confidence * 100)}%`);
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
  const message = response?.ok ? "Actions completed. The page may have changed; send another message to continue." : `Action failed: ${response?.error ?? "Unknown error"}`;
  appendChat("assistant", message);
  render(message);
  pendingPlan = null;
}

function hideApproval() { approval.classList.add("hidden"); pendingPlan = null; }
function setBusy(value: boolean) { run.disabled = value; run.textContent = value ? "Working…" : "Run agent"; }
function render(text: string) { result.textContent = text; result.classList.remove("empty"); }
