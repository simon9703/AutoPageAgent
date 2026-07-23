import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera, CircleStop, Image, LoaderCircle, MousePointer2, Play, Plus,
  Send, Sparkles, X,
} from "lucide-react";
import type {
  AgentEvent, AutomationSkillDraft, BrowserActionPlan, BrowserTabTarget, ChatMessage,
  EditableAutomationSkill, InspectedElement, PageSkillSummary,
  RecordedBrowserAction, RepositoryAnalysis, ServerMessage, SkillCatalogItem,
} from "@auto-page-agent/shared";
import { defaultSkillName, formatRepositoryAnalysis } from "./formatters.js";
import { ApprovalCard, ComposerToolButton, ContextCard, EmptyState, Message, RecordingModal, ScreenshotCard, SkillsModal, TargetTabHeader, Timeline, type SkillView } from "./components.js";
import { Button } from "../components/ui/button.js";
import {
  completedConversationMessage,
  composeAgentTask,
  conversationStorageKey,
  legacyConversationSession,
  LEGACY_CONVERSATION_STORAGE_KEYS,
  normalizeConversationSession,
  summarizeMessageContext,
  toAgentHistory,
} from "./conversation.js";

type Health = Extract<ServerMessage, { type: "health.result" }>;
type Modal = "skills" | "recording" | null;
type ConversationScope = { conversationId: string; targetTabId: number; windowId: number };

export function SidePanelController() {
  const [health, setHealth] = useState<Health | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Ready on the current page.");
  const [pendingPlan, setPendingPlan] = useState<BrowserActionPlan | null>(null);
  const [selected, setSelected] = useState<{
    element: InspectedElement;
    pageUrl: string;
    screenshot?: { dataUrl: string; title: string; url: string };
  } | null>(null);
  const [selectionMode, setSelectionMode] = useState<"element" | "image" | null>(null);
  const [screenshot, setScreenshot] = useState<{ dataUrl: string; title: string; url: string } | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [skillView, setSkillView] = useState<SkillView>("page");
  const [pageSkills, setPageSkills] = useState<PageSkillSummary[]>([]);
  const [skillScope, setSkillScope] = useState("Current page");
  const [catalog, setCatalog] = useState<{ installed: SkillCatalogItem[]; marketplace: SkillCatalogItem[] }>({ installed: [], marketplace: [] });
  const [recording, setRecording] = useState(false);
  const [recordedActions, setRecordedActions] = useState<RecordedBrowserAction[]>([]);
  const [recordingStartUrl, setRecordingStartUrl] = useState("");
  const [skillName, setSkillName] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [editingSkillSlug, setEditingSkillSlug] = useState("");
  const [targetTab, setTargetTab] = useState<BrowserTabTarget | null>(null);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const targetTabRef = useRef<BrowserTabTarget | null>(null);
  const conversationIdRef = useRef<string>(crypto.randomUUID());
  const windowIdRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const activeTaskRef = useRef("");
  const pendingUserTaskRef = useRef<string | null>(null);

  useEffect(() => {
    void initialize();
    const listener = (message: unknown) => {
      const value = message as { type?: string; element?: InspectedElement; pageUrl?: string; tabId?: number; windowId?: number; targetTabId?: number; screenshot?: { dataUrl: string; title: string; url: string }; reason?: string; actions?: RecordedBrowserAction[]; event?: AgentEvent; conversationId?: string };
      if (typeof value.windowId === "number" && value.windowId !== windowIdRef.current) return;
      if (value.type === "ui.element.selected" && value.element && value.tabId === targetTabRef.current?.tabId) {
        setSelected({ element: value.element, pageUrl: value.pageUrl ?? "", screenshot: value.screenshot });
        setSelectionMode(null);
        setNotice(value.screenshot
          ? `Captured visible <${value.element.tagName}>. It will be included in the next message.`
          : `Selected <${value.element.tagName}>. It will be included in the next message.`);
      }
      if (value.type === "ui.selection.cancelled") {
        setSelectionMode(null);
        setNotice(value.reason || "Selection cancelled.");
      }
      if (value.type === "ui.recording.updated") setRecordedActions(value.actions ?? []);
      if (value.type === "ui.selection.cleared" && value.tabId === targetTabRef.current?.tabId) {
        setSelected(null);
        setScreenshot(null);
        setSelectionMode(null);
      }
      if (value.type === "ui.tabs.changed") {
        if (value.reason === "navigated" && value.tabId === targetTabRef.current?.tabId && !busyRef.current) {
          setPendingPlan(null);
          setSelected(null);
          setScreenshot(null);
        }
        void refreshTabs();
      }
      if (
        value.type === "ui.agent.event"
        && value.event
        && value.conversationId === conversationIdRef.current
        && value.targetTabId === targetTabRef.current?.tabId
        && !stopRequestedRef.current
      ) appendEvent(value.event);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }); }, [messages, pendingPlan]);

  async function initialize() {
    const currentWindow = await chrome.windows.getCurrent();
    if (typeof currentWindow.id !== "number") throw new Error("The current browser window is unavailable.");
    windowIdRef.current = currentWindow.id;
    const storageKey = conversationStorageKey(currentWindow.id);
    const [stored, tabState] = await Promise.all([
      chrome.storage.session.get([storageKey, ...LEGACY_CONVERSATION_STORAGE_KEYS]),
      chrome.runtime.sendMessage({ type: "ui.tabs.list", windowId: currentWindow.id }) as Promise<{ tabs?: BrowserTabTarget[]; activeTabId?: number; windowId?: number }>,
    ]);
    const availableTabs = tabState.tabs ?? [];
    const session = normalizeConversationSession(stored[storageKey]) ?? legacyConversationSession(stored);
    const storedMessages = session?.messages ?? [];
    const initialTarget = session
      ? availableTabs.find((tab) => tab.tabId === session.targetTabId) ?? null
      : availableTabs.find((tab) => tab.tabId === tabState.activeTabId) ?? null;
    const initialConversationId = session?.conversationId ?? crypto.randomUUID();
    conversationIdRef.current = initialConversationId;
    pendingUserTaskRef.current = session?.pendingTask ?? null;
    setMessages(storedMessages);
    setActiveTabId(tabState.activeTabId ?? null);
    setTargetTabValue(initialTarget);
    await persistConversation(initialConversationId, storedMessages, initialTarget?.tabId);
    if (!stored[storageKey]) await chrome.storage.session.remove([...LEGACY_CONVERSATION_STORAGE_KEYS]);
    await Promise.all([
      refreshHealth(),
      initialTarget ? restoreSelection(initialTarget.tabId) : Promise.resolve(),
      restoreRecording(),
      refreshSkills(initialTarget?.tabId),
    ]);
    if (!initialTarget) {
      setNotice(session
        ? "The conversation page was closed. Click New to bind the current page."
        : "Open an http(s) page, then click New.");
    }
  }

  async function persistConversation(id: string, next: ChatMessage[], targetTabId = targetTabRef.current?.tabId) {
    const windowId = windowIdRef.current;
    if (typeof windowId !== "number") return;
    await chrome.storage.session.set({
      [conversationStorageKey(windowId)]: {
        conversationId: id,
        messages: next.slice(-40),
        ...(typeof targetTabId === "number" ? { targetTabId } : {}),
        ...(pendingUserTaskRef.current ? { pendingTask: pendingUserTaskRef.current } : {}),
      },
    });
  }

  function appendMessage(role: ChatMessage["role"], content: string, attachments?: ChatMessage["attachments"]) {
    setMessages((current) => {
      const next = [...current, { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString(), ...(attachments ? { attachments } : {}) }].slice(-40);
      void persistConversation(conversationIdRef.current, next);
      return next;
    });
  }

  function appendEvent(event: AgentEvent) {
    setEvents((current) => {
      return [...current, event].slice(-80);
    });
  }

  function isCurrentScope(scope: ConversationScope): boolean {
    return scope.conversationId === conversationIdRef.current
      && scope.targetTabId === targetTabRef.current?.tabId
      && scope.windowId === windowIdRef.current;
  }

  function setBusyValue(value: boolean) {
    busyRef.current = value;
    setBusy(value);
  }

  async function refreshHealth() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "ui.health" }) as ServerMessage;
      setHealth(response.type === "health.result" ? response : null);
    } catch { setHealth(null); }
  }

  async function restoreSelection(targetTabId: number) {
    const stored = await chrome.runtime.sendMessage({ type: "ui.selection.current", targetTabId }) as { selectedElement?: InspectedElement; selectedElementPageUrl?: string; selectedElementScreenshot?: { dataUrl: string; title: string; url: string } };
    if (stored.selectedElement) {
      setSelected({
        element: stored.selectedElement,
        pageUrl: stored.selectedElementPageUrl ?? "",
        screenshot: stored.selectedElementScreenshot,
      });
    }
  }

  async function restoreRecording() {
    const state = await chrome.runtime.sendMessage({ type: "ui.recording.status" }) as { active?: boolean; startUrl?: string; actions?: RecordedBrowserAction[] };
    setRecording(Boolean(state.active));
    setRecordingStartUrl(state.startUrl ?? "");
    setRecordedActions(state.actions ?? []);
  }

  async function refreshSkills(targetTabId = targetTabRef.current?.tabId) {
    const [pageResponse, catalogResponse] = await Promise.all([
      typeof targetTabId === "number"
        ? chrome.runtime.sendMessage({ type: "ui.skills.list", targetTabId }) as Promise<ServerMessage>
        : Promise.resolve(undefined),
      chrome.runtime.sendMessage({ type: "ui.skills.catalog" }) as Promise<ServerMessage>,
    ]).catch(() => [] as unknown as [ServerMessage | undefined, ServerMessage]);
    if (pageResponse?.type === "skill.list.result") {
      setPageSkills(pageResponse.skills);
      try { setSkillScope(`${new URL(pageResponse.pageUrl).hostname} · ${pageResponse.skills.length} available`); }
      catch { setSkillScope(`${pageResponse.skills.length} available`); }
    }
    if (catalogResponse?.type === "skill.catalog.result") setCatalog({ installed: catalogResponse.installed, marketplace: catalogResponse.marketplace });
  }

  async function refreshTabs() {
    const windowId = windowIdRef.current;
    if (typeof windowId !== "number") return;
    const response = await chrome.runtime.sendMessage({ type: "ui.tabs.list", windowId }) as { tabs?: BrowserTabTarget[]; activeTabId?: number; windowId?: number };
    const availableTabs = response.tabs ?? [];
    setActiveTabId(response.activeTabId ?? null);
    const current = targetTabRef.current;
    if (!current) return;
    const refreshed = availableTabs.find((tab) => tab.tabId === current.tabId) ?? null;
    setTargetTabValue(refreshed);
    if (!refreshed) {
      setPendingPlan(null);
      setSelected(null);
      setScreenshot(null);
      setSelectionMode(null);
      setNotice("The conversation page was closed. Click New to bind the current page.");
      return;
    }
    if (refreshed.url !== current.url) void refreshSkills(refreshed.tabId);
  }

  function setTargetTabValue(tab: BrowserTabTarget | null) {
    targetTabRef.current = tab;
    setTargetTab(tab);
  }

  async function newConversation() {
    if (busyRef.current) return;
    const windowId = windowIdRef.current;
    if (typeof windowId !== "number") return;
    const tabState = await chrome.runtime.sendMessage({ type: "ui.tabs.list", windowId }) as { tabs?: BrowserTabTarget[]; activeTabId?: number };
    const activeTarget = (tabState.tabs ?? []).find((tab) => tab.tabId === tabState.activeTabId) ?? null;
    const oldId = conversationIdRef.current;
    const oldTargetTabId = targetTabRef.current?.tabId;
    const nextId = crypto.randomUUID();
    conversationIdRef.current = nextId;
    setMessages([]);
    setEvents([]);
    setPendingPlan(null);
    setSelected(null);
    setScreenshot(null);
    setPrompt("");
    activeTaskRef.current = "";
    pendingUserTaskRef.current = null;
    setActiveTabId(tabState.activeTabId ?? null);
    setTargetTabValue(activeTarget);
    setNotice(activeTarget
      ? "New conversation. Bound to the page you are viewing now."
      : "Open an http(s) page, then click New.");
    await chrome.runtime.sendMessage({
      type: "ui.conversation.reset",
      conversationId: oldId,
      targetTabId: oldTargetTabId,
      windowId,
    }).catch(() => undefined);
    await persistConversation(nextId, [], activeTarget?.tabId);
    if (activeTarget) await Promise.all([restoreSelection(activeTarget.tabId), refreshSkills(activeTarget.tabId)]);
    inputRef.current?.focus();
  }

  async function startSelection(mode: "element" | "image") {
    if (!targetTab) return setNotice("Choose a target page first.");
    setSelectionMode(mode);
    setNotice(mode === "image" ? "Click any visible element to capture it · Esc to cancel" : "Click any element on the page · Esc to cancel");
    const response = await chrome.runtime.sendMessage({ type: "ui.selection.start", mode, targetTabId: targetTab.tabId }) as { ok?: boolean; error?: string };
    if (!response?.ok) {
      setSelectionMode(null);
      setNotice(`Selection failed: ${response?.error ?? "Open an http(s) page and reload the extension."}`);
    }
  }

  async function captureScreenshot() {
    if (!targetTab) return setNotice("Choose a target page first.");
    setNotice("Capturing the visible page…");
    const response = await chrome.runtime.sendMessage({ type: "ui.screenshot.capture", targetTabId: targetTab.tabId }) as { ok?: boolean; dataUrl?: string; title?: string; url?: string; error?: string };
    if (!response.ok || !response.dataUrl) return setNotice(`Screenshot failed: ${response.error ?? "Unknown error"}`);
    setScreenshot({ dataUrl: response.dataUrl, title: response.title || "Current page", url: response.url || "" });
    setNotice("Screenshot captured locally.");
  }

  async function clearContext() {
    const targetTabId = targetTabRef.current?.tabId;
    setSelected(null);
    setScreenshot(null);
    await chrome.runtime.sendMessage({
      type: "ui.selection.clear",
      targetTabId,
      windowId: windowIdRef.current,
    }).catch(() => undefined);
  }

  async function submitTask(event?: React.FormEvent) {
    event?.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;
    if (!targetTab) return setNotice("Choose a target page first.");
    const scope: ConversationScope = {
      conversationId: conversationIdRef.current,
      targetTabId: targetTab.tabId,
      windowId: targetTab.windowId,
    };
    const task = composeAgentTask(text, pendingUserTaskRef.current);
    activeTaskRef.current = task;
    pendingUserTaskRef.current = null;
    const history = toAgentHistory(messages.slice(-20));
    const attachments = summarizeMessageContext(selected, screenshot);
    setEvents([]);
    appendMessage("user", text, attachments);
    setPrompt("");
    setBusyValue(true);
    stopRequestedRef.current = false;
    setPendingPlan(null);
    setNotice("Agent is working…");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "ui.run", task, history, ...scope,
        ...(screenshot ? { screenshot: { dataUrl: screenshot.dataUrl, title: screenshot.title, url: screenshot.url } } : {}),
      }) as ServerMessage;
      if (stopRequestedRef.current || !isCurrentScope(scope)) return;
      if (response.type === "agent.error") throw new Error(response.error);
      if (response.type !== "agent.result") throw new Error("Unexpected bridge response.");
      await clearContext();
      if (response.decision.kind === "action_plan") {
        setPendingPlan(response.decision);
        setNotice("Action ready. Confirm once to let the agent act, observe, and continue automatically.");
      } else if (response.decision.kind === "answer") {
        activeTaskRef.current = "";
        appendMessage("assistant", response.decision.content);
        setNotice(`Answered by ${response.provider}.`);
      } else if (response.decision.kind === "complete") {
        activeTaskRef.current = "";
        appendMessage("assistant", response.decision.summary);
        setNotice("The requested page state is already complete.");
      } else if (response.decision.kind === "needs_user") {
        pendingUserTaskRef.current = task;
        appendMessage("assistant", response.decision.question);
        setNotice("The agent needs more information.");
      } else {
        activeTaskRef.current = "";
        appendMessage("assistant", `Unable to continue: ${response.decision.reason}`);
        setNotice(response.decision.reason);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!stopRequestedRef.current) {
        appendMessage("assistant", `Error: ${message}`);
        setNotice(message);
      }
    } finally { setBusyValue(false); }
  }

  async function executePlan() {
    if (!pendingPlan || busy) return;
    const plan = pendingPlan;
    setPendingPlan(null);
    setBusyValue(true);
    stopRequestedRef.current = false;
    setNotice("Agent is operating the page and verifying each step…");
    try {
      const target = targetTabRef.current;
      const windowId = windowIdRef.current;
      if (!target || typeof windowId !== "number") throw new Error("The conversation page is unavailable. Click New to bind the current page.");
      const scope: ConversationScope = { conversationId: conversationIdRef.current, targetTabId: target.tabId, windowId };
      const response = await chrome.runtime.sendMessage({ type: "ui.execute", plan, ...scope }) as {
        ok?: boolean;
        status?: "completed" | "needs_user" | "blocked";
        answer?: string;
        question?: string;
        evidence?: string[];
        steps?: number;
        recoverable?: boolean;
        error?: string;
      };
      if (stopRequestedRef.current || !isCurrentScope(scope)) return;
      if (response.status === "needs_user") {
        pendingUserTaskRef.current = activeTaskRef.current;
        appendMessage("assistant", response.question ?? "More information is required.");
        setNotice("The agent needs more information.");
        return;
      }
      if (response.status === "blocked") {
        activeTaskRef.current = "";
        appendMessage("assistant", `Unable to continue: ${response.error ?? "The page task is blocked."}`);
        setNotice(response.recoverable ? "The page changed. You can revise the request and try again." : "The agent cannot continue safely.");
        return;
      }
      if (!response.ok) throw new Error(response.error ?? "Action failed.");
      activeTaskRef.current = "";
      appendMessage("assistant", completedConversationMessage(response.answer));
      setNotice(`Page task completed in ${response.steps ?? 1} step(s).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!stopRequestedRef.current) {
        appendMessage("assistant", `Action stopped: ${message}`);
        setNotice(message);
      }
    } finally { setBusyValue(false); }
  }

  async function stopAgent() {
    if (!busyRef.current) return;
    stopRequestedRef.current = true;
    setPendingPlan(null);
    setNotice("Stopping the agent…");
    const response = await chrome.runtime.sendMessage({
      type: "ui.agent.stop",
      conversationId: conversationIdRef.current,
      targetTabId: targetTabRef.current?.tabId,
      windowId: windowIdRef.current,
    }) as { ok?: boolean; stopped?: boolean; error?: string };
    setNotice(response.ok ? "Agent stopped." : `Stop failed: ${response.error ?? "Unknown error"}`);
  }

  async function showConversationPage() {
    const targetTabId = targetTabRef.current?.tabId;
    if (typeof targetTabId !== "number") return;
    await chrome.runtime.sendMessage({ type: "ui.tab.activate", targetTabId }).catch(() => undefined);
  }

  async function analyzeCode() {
    if (!selected || !targetTab) return;
    setNotice("Searching configured repositories…");
    const response = await chrome.runtime.sendMessage({ type: "ui.repository.analyze", element: selected.element, pageUrl: selected.pageUrl, targetTabId: targetTab.tabId }) as ServerMessage;
    if (response.type === "agent.error") return setNotice(response.error);
    if (response.type !== "repository.result") return setNotice("Unexpected repository response.");
    appendMessage("assistant", formatRepositoryAnalysis(response.analysis));
    setNotice("Repository evidence added to the conversation.");
  }

  function chooseSkill(skill: Pick<SkillCatalogItem, "name" | "description">, debug = false) {
    setPrompt(`${debug ? "Debug and run" : "Use"} the “${skill.name}” Skill on the current page. ${skill.description}`.trim());
    setModal(null);
    setNotice(`${skill.name} selected. Add any inputs, then send.`);
    queueMicrotask(() => inputRef.current?.focus());
  }

  async function installSkill(slug: string, updateAvailable: boolean) {
    if (updateAvailable && !confirm("Update this Skill template? Your other custom Skills are unaffected.")) return;
    const response = await chrome.runtime.sendMessage({ type: "ui.skill.install", slug }) as ServerMessage;
    if (response.type === "agent.error") return setNotice(response.error);
    await refreshSkills();
    setNotice(response.type === "skill.installed" ? `${response.skill.name} installed.` : "Unexpected Skill response.");
  }

  async function configureSkill(slug: string, enabled: boolean) {
    const response = await chrome.runtime.sendMessage({ type: "ui.skill.configure", slug, enabled }) as ServerMessage;
    if (response.type === "agent.error") return setNotice(response.error);
    await refreshSkills();
  }

  async function editSkill(slug: string) {
    const response = await chrome.runtime.sendMessage({ type: "ui.skill.get", slug }) as ServerMessage;
    if (response.type !== "skill.detail") return setNotice(response.type === "agent.error" ? response.error : "Unexpected Skill response.");
    const skill: EditableAutomationSkill = response.skill;
    setEditingSkillSlug(skill.slug);
    setRecording(false);
    setRecordingStartUrl(skill.startUrl ?? "");
    setRecordedActions(skill.steps);
    setSkillName(skill.name);
    setSkillDescription(skill.description);
    setModal("recording");
  }

  async function toggleRecording() {
    if (!recording && !targetTab) return setNotice("Choose a target page first.");
    const response = await chrome.runtime.sendMessage({ type: recording ? "ui.recording.stop" : "ui.recording.start", targetTabId: targetTab?.tabId }) as { active?: boolean; startUrl?: string; actions?: RecordedBrowserAction[]; error?: string };
    if (response.error) return setNotice(response.error);
    const active = !recording;
    setRecording(active);
    setRecordingStartUrl(response.startUrl ?? recordingStartUrl);
    setRecordedActions(response.actions ?? []);
    if (active && !skillName) setSkillName(defaultSkillName(response.startUrl ?? ""));
    setModal("recording");
    setNotice(active ? "Recording page actions. Stop when the workflow is complete." : "Recording stopped. Review and save it as a Skill.");
  }

  async function replayRecording() {
    if (!targetTab) return setNotice("Choose a target page first.");
    if (!recordedActions.length || !confirm(`Replay ${recordedActions.length} action(s) on the current page?`)) return;
    const response = await chrome.runtime.sendMessage({ type: "ui.recording.replay", actions: recordedActions, targetTabId: targetTab.tabId }) as { ok?: boolean; error?: string };
    setNotice(response.ok ? "Workflow replay completed." : response.error ?? "Replay failed.");
  }

  async function saveSkill() {
    if (recording || !recordedActions.length || !skillName.trim()) return setNotice("Stop recording and provide a Skill name first.");
    const draft: AutomationSkillDraft = {
      name: skillName.trim(), description: skillDescription.trim() || `Replay the recorded ${skillName.trim()} workflow.`,
      startUrl: recordingStartUrl || recordedActions[0]!.url, createdAt: new Date().toISOString(), requiresConfirmation: true, steps: recordedActions,
    };
    const response = await chrome.runtime.sendMessage({ type: "ui.skill.save", draft, ...(editingSkillSlug ? { existingSlug: editingSkillSlug } : {}) }) as ServerMessage;
    if (response.type !== "skill.saved") return setNotice(response.type === "agent.error" ? response.error : "Unexpected Skill response.");
    setEditingSkillSlug(response.skill.slug);
    await refreshSkills();
    setNotice(`${response.skill.name} v${response.skill.version} saved locally.`);
  }

  const activeSkills = skillView === "page" ? pageSkills : skillView === "installed" ? catalog.installed : catalog.marketplace;
  const contextLabel = selected ? selected.element.label || selected.element.text || `<${selected.element.tagName}>` : screenshot ? screenshot.title : "";

  return (
    <main className="flex h-screen min-h-[520px] flex-col overflow-hidden bg-[#f7f8fa] text-slate-900">
      <header className="relative flex h-[72px] shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-4">
        <TargetTabHeader
          target={targetTab}
          activeTabId={activeTabId}
          onActivate={() => void showConversationPage()}
        />
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${health?.ok ? "bg-emerald-500" : "bg-amber-400"}`} title={health?.agent.error ?? health?.agent.name ?? "Bridge unavailable"} />
          <Button size="sm" disabled={busy} onClick={() => void newConversation()} aria-label="New conversation">
            <Plus size={14} />
            New
          </Button>
        </div>
      </header>

      <section ref={threadRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {!messages.length && !busy ? <EmptyState onPick={() => void startSelection("element")} onSkills={() => setModal("skills")} /> : null}
        <div className="space-y-5">
          {messages.map((message) => <Message key={message.id} message={message} />)}
          {busy ? <div className="flex items-center gap-2 text-xs text-slate-400"><LoaderCircle className="animate-spin" size={15} />Agent is working on the page…</div> : null}
        </div>

        {selected ? <ContextCard selected={selected.element} screenshot={selected.screenshot} onClose={() => void clearContext()} onAnalyze={() => void analyzeCode()} /> : null}
        {screenshot ? <ScreenshotCard screenshot={screenshot} onClose={() => setScreenshot(null)} /> : null}
        {events.length ? <Timeline events={events} /> : null}
      </section>

      <div className="shrink-0 px-3 pb-3">
        {pendingPlan ? <ApprovalCard plan={pendingPlan} onCancel={() => setPendingPlan(null)} onConfirm={() => void executePlan()} /> : null}
        <form onSubmit={(event) => void submitTask(event)} className="composer rounded-[22px] border border-slate-200 bg-white p-2.5 shadow-[0_10px_32px_rgba(15,23,42,.09)] transition focus-within:border-slate-300 focus-within:shadow-[0_12px_36px_rgba(15,23,42,.12)]">
          {contextLabel ? <div className="mb-2 flex"><span className="flex max-w-full items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600"><MousePointer2 size={12} /><span className="truncate">{contextLabel}</span><button type="button" onClick={() => void clearContext()} aria-label="Remove context"><X size={12} /></button></span></div> : null}
          <textarea ref={inputRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitTask(); } }} rows={2} placeholder="Ask about this page or tell the agent what to do…" className="composer-input max-h-32 min-h-10 w-full resize-none border-0 bg-transparent px-1 text-[14px] leading-5 outline-none placeholder:text-slate-400" />
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-0.5" aria-label="Page tools">
              <ComposerToolButton active={selectionMode === "element"} label="Select element" onClick={() => void startSelection("element")}><MousePointer2 size={15} /></ComposerToolButton>
              <ComposerToolButton active={selectionMode === "image"} label="Select image area" onClick={() => void startSelection("image")}><Image size={15} /></ComposerToolButton>
              <ComposerToolButton active={Boolean(screenshot)} label="Capture viewport" onClick={() => void captureScreenshot()}><Camera size={15} /></ComposerToolButton>
              <ComposerToolButton label="Open Skills" onClick={() => setModal("skills")}><Sparkles size={15} /></ComposerToolButton>
              <ComposerToolButton active={recording} label={recording ? "Stop recording" : "Record workflow"} onClick={() => void toggleRecording()}>{recording ? <CircleStop size={15} /> : <Play size={15} />}</ComposerToolButton>
            </div>
            {busy
              ? <button type="button" onClick={() => void stopAgent()} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-950 text-white transition hover:bg-slate-700" aria-label="Stop agent" title="Stop agent"><CircleStop size={15} /></button>
              : <button type="submit" disabled={!prompt.trim()} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-950 text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-200" aria-label="Send"><Send size={14} /></button>}
          </div>
        </form>
        <p className="mt-1.5 truncate px-2 text-center text-[10px] text-slate-400">{notice}</p>
      </div>

      {modal === "skills" ? <SkillsModal view={skillView} setView={setSkillView} scope={skillScope} items={activeSkills} onClose={() => setModal(null)} onRefresh={() => void refreshSkills()} onUse={chooseSkill} onInstall={(slug, update) => void installSkill(slug, update)} onToggle={(slug, enabled) => void configureSkill(slug, enabled)} onEdit={(slug) => void editSkill(slug)} /> : null}
      {modal === "recording" ? <RecordingModal active={recording} actions={recordedActions} name={skillName} description={skillDescription} editing={Boolean(editingSkillSlug)} onName={setSkillName} onDescription={setSkillDescription} onClose={() => setModal(null)} onToggle={() => void toggleRecording()} onReplay={() => void replayRecording()} onSave={() => void saveSkill()} /> : null}
    </main>
  );
}
