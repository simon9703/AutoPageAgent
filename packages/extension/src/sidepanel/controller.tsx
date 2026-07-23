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

type Health = Extract<ServerMessage, { type: "health.result" }>;
type Modal = "skills" | "recording" | null;

export function SidePanelController() {
  const [health, setHealth] = useState<Health | null>(null);
  const [conversationId, setConversationId] = useState<string>(crypto.randomUUID());
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
  const [tabs, setTabs] = useState<BrowserTabTarget[]>([]);
  const [targetTab, setTargetTab] = useState<BrowserTabTarget | null>(null);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const [queuedTarget, setQueuedTarget] = useState<BrowserTabTarget | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const targetTabRef = useRef<BrowserTabTarget | null>(null);
  const busyRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const conversationStartedRef = useRef(false);

  useEffect(() => {
    void initialize();
    const listener = (message: unknown) => {
      const value = message as { type?: string; element?: InspectedElement; pageUrl?: string; tabId?: number; screenshot?: { dataUrl: string; title: string; url: string }; reason?: string; actions?: RecordedBrowserAction[]; event?: AgentEvent };
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
      if (value.type === "ui.agent.event" && value.event) appendEvent(value.event);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }); }, [messages, pendingPlan]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => {
    if (!busy && !pendingPlan && !recording && queuedTarget) {
      setQueuedTarget(null);
      void switchTargetNow(queuedTarget);
    }
  }, [busy, pendingPlan, queuedTarget, recording]);

  async function initialize() {
    const [stored, tabState] = await Promise.all([
      chrome.storage.session.get(["conversationId", "chatMessages", "conversationTargetTabId"]),
      chrome.runtime.sendMessage({ type: "ui.tabs.list" }) as Promise<{ tabs?: BrowserTabTarget[]; activeTabId?: number }>,
    ]);
    const availableTabs = tabState.tabs ?? [];
    const storedMessages = Array.isArray(stored.chatMessages) ? (stored.chatMessages as ChatMessage[]).slice(-40) : [];
    const conversationStarted = storedMessages.length > 0;
    const storedTargetId = conversationStarted && typeof stored.conversationTargetTabId === "number"
      ? stored.conversationTargetTabId
      : undefined;
    const initialTarget = availableTabs.find((tab) => tab.tabId === storedTargetId)
      ?? availableTabs.find((tab) => tab.tabId === tabState.activeTabId)
      ?? availableTabs[0]
      ?? null;
    const initialConversationId = typeof stored.conversationId === "string" ? stored.conversationId : crypto.randomUUID();
    conversationStartedRef.current = conversationStarted;
    setConversationId(initialConversationId);
    setMessages(storedMessages);
    setTabs(availableTabs);
    setActiveTabId(tabState.activeTabId ?? null);
    setTargetTabValue(initialTarget);
    await chrome.storage.session.set({
      conversationId: initialConversationId,
      ...(initialTarget ? { conversationTargetTabId: initialTarget.tabId } : {}),
    });
    await Promise.all([
      refreshHealth(),
      initialTarget ? restoreSelection(initialTarget.tabId) : Promise.resolve(),
      restoreRecording(),
      refreshSkills(initialTarget?.tabId),
    ]);
    if (!initialTarget) setNotice("Open an http(s) page, then choose it as the target.");
  }

  async function persistConversation(id: string, next: ChatMessage[], targetTabId = targetTabRef.current?.tabId) {
    await chrome.storage.session.set({
      conversationId: id,
      chatMessages: next.slice(-40),
      ...(typeof targetTabId === "number" ? { conversationTargetTabId: targetTabId } : {}),
    });
  }

  function appendMessage(role: ChatMessage["role"], content: string) {
    setMessages((current) => {
      const next = [...current, { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString() }].slice(-40);
      void persistConversation(conversationId, next);
      return next;
    });
  }

  function appendEvent(event: AgentEvent) {
    setEvents((current) => {
      const last = current.at(-1);
      if (event.type === "thinking" && event.delta && last?.type === "thinking" && last.delta) {
        return [...current.slice(0, -1), { ...last, content: `${last.content}${event.content}`.slice(-1_000), timestamp: event.timestamp }];
      }
      return [...current, event].slice(-80);
    });
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
    const response = await chrome.runtime.sendMessage({ type: "ui.tabs.list" }) as { tabs?: BrowserTabTarget[]; activeTabId?: number };
    const availableTabs = response.tabs ?? [];
    setTabs(availableTabs);
    setActiveTabId(response.activeTabId ?? null);
    const current = targetTabRef.current;
    if (!conversationStartedRef.current) {
      const active = availableTabs.find((tab) => tab.tabId === response.activeTabId) ?? availableTabs[0] ?? null;
      setTargetTabValue(active);
      if (active?.tabId !== current?.tabId) {
        setSelected(null);
        setScreenshot(null);
        setSelectionMode(null);
        setPendingPlan(null);
        await Promise.all([
          active
            ? chrome.storage.session.set({ conversationTargetTabId: active.tabId })
            : chrome.storage.session.remove(["conversationTargetTabId"]),
          chrome.runtime.sendMessage({ type: "ui.selection.clear" }).catch(() => undefined),
        ]);
        if (active) await refreshSkills(active.tabId);
        setNotice(active ? "Ready on the current page." : "Open an http(s) page to get started.");
      }
      return;
    }
    if (!current) return;
    const refreshed = availableTabs.find((tab) => tab.tabId === current.tabId) ?? null;
    setTargetTabValue(refreshed);
    if (!refreshed) {
      setPendingPlan(null);
      setNotice("The target page was closed. Choose another tab.");
      return;
    }
    if (refreshed.url !== current.url) void refreshSkills(refreshed.tabId);
  }

  function setTargetTabValue(tab: BrowserTabTarget | null) {
    targetTabRef.current = tab;
    setTargetTab(tab);
  }

  async function chooseTarget(tab: BrowserTabTarget) {
    setTargetPickerOpen(false);
    if (tab.tabId === targetTabRef.current?.tabId) return;
    if (busy || pendingPlan || recording) {
      setQueuedTarget(tab);
      setNotice(recording
        ? "Target change queued. Stop recording before switching pages."
        : "Target change queued. The current task will finish on its original page.");
      return;
    }
    await switchTargetNow(tab);
  }

  async function switchTargetNow(tab: BrowserTabTarget) {
    const previous = targetTabRef.current;
    setTargetTabValue(tab);
    setSelected(null);
    setScreenshot(null);
    setSelectionMode(null);
    setPendingPlan(null);
    await Promise.all([
      chrome.storage.session.set({ conversationTargetTabId: tab.tabId }),
      chrome.runtime.sendMessage({ type: "ui.selection.clear" }).catch(() => undefined),
    ]);
    await Promise.all([restoreSelection(tab.tabId), refreshSkills(tab.tabId)]);
    setNotice(previous ? `Target changed to ${tab.title}.` : `Target set to ${tab.title}.`);
  }

  async function newConversation() {
    const oldId = conversationId;
    const nextId = crypto.randomUUID();
    setConversationId(nextId);
    setMessages([]);
    setEvents([]);
    setPendingPlan(null);
    setSelected(null);
    setScreenshot(null);
    setPrompt("");
    conversationStartedRef.current = false;
    const activeTarget = tabs.find((tab) => tab.tabId === activeTabId) ?? targetTabRef.current;
    if (activeTarget) setTargetTabValue(activeTarget);
    setQueuedTarget(null);
    setNotice("New conversation. Bound to the page you are viewing now.");
    await chrome.runtime.sendMessage({ type: "ui.conversation.reset", conversationId: oldId }).catch(() => undefined);
    await persistConversation(nextId, [], activeTarget?.tabId);
    if (activeTarget) await refreshSkills(activeTarget.tabId);
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
    setSelected(null);
    setScreenshot(null);
    await chrome.runtime.sendMessage({ type: "ui.selection.clear" }).catch(() => undefined);
  }

  async function submitTask(event?: React.FormEvent) {
    event?.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;
    if (!targetTab) return setNotice("Choose a target page first.");
    conversationStartedRef.current = true;
    const history = messages.slice(-20);
    setEvents([]);
    appendMessage("user", text);
    setPrompt("");
    setBusy(true);
    stopRequestedRef.current = false;
    setPendingPlan(null);
    setNotice("Reading the current page and planning…");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "ui.run", task: text, conversationId, history, targetTabId: targetTab.tabId,
        ...(screenshot ? { screenshot: { dataUrl: screenshot.dataUrl, title: screenshot.title, url: screenshot.url } } : {}),
      }) as ServerMessage;
      if (response.type === "agent.error") throw new Error(response.error);
      if (response.type !== "agent.result") throw new Error("Unexpected bridge response.");
      if (response.decision.kind === "action_plan") {
        setPendingPlan(response.decision);
        appendMessage("assistant", response.decision.summary);
        setNotice("Action ready. Confirm once to let the agent act, observe, and continue automatically.");
      } else if (response.decision.kind === "answer") {
        appendMessage("assistant", response.decision.content);
        setNotice(`Answered by ${response.provider}.`);
      } else if (response.decision.kind === "complete") {
        appendMessage("assistant", response.decision.summary);
        setNotice("The requested page state is already complete.");
      } else if (response.decision.kind === "needs_user") {
        appendMessage("assistant", response.decision.question);
        setNotice("The agent needs more information.");
      } else {
        appendMessage("assistant", `Unable to continue: ${response.decision.reason}`);
        setNotice(response.decision.reason);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!stopRequestedRef.current) {
        appendMessage("assistant", `Error: ${message}`);
        setNotice(message);
      }
    } finally { setBusy(false); }
  }

  async function executePlan() {
    if (!pendingPlan || busy) return;
    const plan = pendingPlan;
    setPendingPlan(null);
    setBusy(true);
    stopRequestedRef.current = false;
    setNotice("Agent is operating the page and verifying each step…");
    try {
      const response = await chrome.runtime.sendMessage({ type: "ui.execute", plan }) as {
        ok?: boolean;
        status?: "completed" | "needs_user" | "blocked";
        answer?: string;
        question?: string;
        evidence?: string[];
        steps?: number;
        error?: string;
      };
      if (response.status === "needs_user") {
        appendMessage("assistant", response.question ?? "More information is required.");
        setNotice("The agent needs more information.");
        return;
      }
      if (!response.ok) throw new Error(response.error ?? "Action failed.");
      const message = `${response.answer ?? "Task completed."}\n\nCompleted in ${response.steps ?? 1} agent step(s).`;
      appendMessage("assistant", message);
      setNotice("Page task completed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!stopRequestedRef.current) {
        appendMessage("assistant", `Action stopped: ${message}`);
        setNotice(message);
      }
    } finally { setBusy(false); }
  }

  async function stopAgent() {
    if (!busyRef.current) return;
    stopRequestedRef.current = true;
    setPendingPlan(null);
    setNotice("Stopping the agent…");
    const response = await chrome.runtime.sendMessage({ type: "ui.agent.stop", conversationId }) as { ok?: boolean; stopped?: boolean; error?: string };
    setBusy(false);
    setNotice(response.ok ? "Agent stopped." : `Stop failed: ${response.error ?? "Unknown error"}`);
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
          tabs={tabs}
          activeTabId={activeTabId}
          open={targetPickerOpen}
          queued={queuedTarget}
          onToggle={() => setTargetPickerOpen((current) => !current)}
          onChoose={(tab) => void chooseTarget(tab)}
        />
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${health?.ok ? "bg-emerald-500" : "bg-amber-400"}`} title={health?.agent.error ?? health?.agent.name ?? "Bridge unavailable"} />
          <Button size="sm" onClick={() => void newConversation()} aria-label="New conversation">
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
