import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bot, Camera, Check, ChevronDown, CircleStop, Code2, Copy, Image,
  LoaderCircle, MousePointer2, Play, Plus, RefreshCw, Send, Sparkles,
  SquarePen, WandSparkles, X,
} from "lucide-react";
import type {
  AgentEvent, AutomationSkillDraft, BrowserActionPlan, ChatMessage,
  EditableAutomationSkill, InspectedElement, PageSkillSummary,
  RecordedBrowserAction, RepositoryAnalysis, ServerMessage, SkillCatalogItem,
} from "@auto-page-agent/shared";

type Health = Extract<ServerMessage, { type: "health.result" }>;
type SkillView = "page" | "installed" | "marketplace";
type Modal = "skills" | "recording" | null;

function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [conversationId, setConversationId] = useState<string>(crypto.randomUUID());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Ready on the current page.");
  const [pendingPlan, setPendingPlan] = useState<BrowserActionPlan | null>(null);
  const [selected, setSelected] = useState<{ element: InspectedElement; pageUrl: string } | null>(null);
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
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void Promise.all([restoreConversation(), refreshHealth(), restoreSelection(), restoreRecording(), refreshSkills()]);
    const listener = (message: unknown) => {
      const value = message as { type?: string; element?: InspectedElement; pageUrl?: string; actions?: RecordedBrowserAction[]; event?: AgentEvent };
      if (value.type === "ui.element.selected" && value.element) {
        setSelected({ element: value.element, pageUrl: value.pageUrl ?? "" });
        setSelectionMode(null);
        setNotice(`Selected <${value.element.tagName}>. It will be included in the next message.`);
      }
      if (value.type === "ui.selection.cancelled") {
        setSelectionMode(null);
        setNotice("Selection cancelled.");
      }
      if (value.type === "ui.recording.updated") setRecordedActions(value.actions ?? []);
      if (value.type === "ui.page.changed") void refreshSkills();
      if (value.type === "ui.agent.event" && value.event) appendEvent(value.event);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }); }, [messages, pendingPlan]);

  async function restoreConversation() {
    const stored = await chrome.storage.session.get(["conversationId", "chatMessages"]);
    setConversationId(typeof stored.conversationId === "string" ? stored.conversationId : crypto.randomUUID());
    setMessages(Array.isArray(stored.chatMessages) ? (stored.chatMessages as ChatMessage[]).slice(-40) : []);
  }

  async function persistConversation(id: string, next: ChatMessage[]) {
    await chrome.storage.session.set({ conversationId: id, chatMessages: next.slice(-40) });
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

  async function restoreSelection() {
    const stored = await chrome.runtime.sendMessage({ type: "ui.selection.current" }) as { selectedElement?: InspectedElement; selectedElementPageUrl?: string };
    if (stored.selectedElement) setSelected({ element: stored.selectedElement, pageUrl: stored.selectedElementPageUrl ?? "" });
  }

  async function restoreRecording() {
    const state = await chrome.runtime.sendMessage({ type: "ui.recording.status" }) as { active?: boolean; startUrl?: string; actions?: RecordedBrowserAction[] };
    setRecording(Boolean(state.active));
    setRecordingStartUrl(state.startUrl ?? "");
    setRecordedActions(state.actions ?? []);
  }

  async function refreshSkills() {
    const [pageResponse, catalogResponse] = await Promise.all([
      chrome.runtime.sendMessage({ type: "ui.skills.list" }) as Promise<ServerMessage>,
      chrome.runtime.sendMessage({ type: "ui.skills.catalog" }) as Promise<ServerMessage>,
    ]).catch(() => [] as unknown as [ServerMessage, ServerMessage]);
    if (pageResponse?.type === "skill.list.result") {
      setPageSkills(pageResponse.skills);
      try { setSkillScope(`${new URL(pageResponse.pageUrl).hostname} · ${pageResponse.skills.length} available`); }
      catch { setSkillScope(`${pageResponse.skills.length} available`); }
    }
    if (catalogResponse?.type === "skill.catalog.result") setCatalog({ installed: catalogResponse.installed, marketplace: catalogResponse.marketplace });
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
    setNotice("New conversation. Current-page context was reset.");
    await chrome.runtime.sendMessage({ type: "ui.conversation.reset", conversationId: oldId }).catch(() => undefined);
    await persistConversation(nextId, []);
    inputRef.current?.focus();
  }

  async function startSelection(mode: "element" | "image") {
    setSelectionMode(mode);
    setNotice(mode === "image" ? "Click an image on the page · Esc to cancel" : "Click any element on the page · Esc to cancel");
    const response = await chrome.runtime.sendMessage({ type: "ui.selection.start", mode }) as { ok?: boolean; error?: string };
    if (!response?.ok) {
      setSelectionMode(null);
      setNotice(`Selection failed: ${response?.error ?? "Open an http(s) page and reload the extension."}`);
    }
  }

  async function captureScreenshot() {
    setNotice("Capturing the visible page…");
    const response = await chrome.runtime.sendMessage({ type: "ui.screenshot.capture" }) as { ok?: boolean; dataUrl?: string; title?: string; url?: string; error?: string };
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
    const history = messages.slice(-20);
    setEvents([]);
    appendMessage("user", text);
    setPrompt("");
    setBusy(true);
    setPendingPlan(null);
    setNotice("Reading the current page and planning…");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "ui.run", task: text, conversationId, history,
        ...(screenshot ? { screenshot: { dataUrl: screenshot.dataUrl, title: screenshot.title, url: screenshot.url } } : {}),
      }) as ServerMessage;
      if (response.type === "agent.error") throw new Error(response.error);
      if (response.type !== "agent.result") throw new Error("Unexpected bridge response.");
      if (response.decision.kind === "answer") {
        appendMessage("assistant", response.decision.content);
        setNotice(`Answered by ${response.provider}.`);
      } else {
        setPendingPlan(response.decision);
        appendMessage("assistant", response.decision.summary);
        setNotice("Action ready. Confirm once to let the agent act, observe, and continue automatically.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendMessage("assistant", `Error: ${message}`);
      setNotice(message);
    } finally { setBusy(false); }
  }

  async function executePlan() {
    if (!pendingPlan || busy) return;
    const plan = pendingPlan;
    setPendingPlan(null);
    setBusy(true);
    setNotice("Agent is operating the page and verifying each step…");
    try {
      const response = await chrome.runtime.sendMessage({ type: "ui.execute", plan }) as { ok?: boolean; answer?: string; steps?: number; error?: string };
      if (!response.ok) throw new Error(response.error ?? "Action failed.");
      const message = `${response.answer ?? "Task completed."}\n\nCompleted in ${response.steps ?? 1} agent step(s).`;
      appendMessage("assistant", message);
      setNotice("Page task completed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendMessage("assistant", `Action stopped: ${message}`);
      setNotice(message);
    } finally { setBusy(false); }
  }

  async function analyzeCode() {
    if (!selected) return;
    setNotice("Searching configured repositories…");
    const response = await chrome.runtime.sendMessage({ type: "ui.repository.analyze", element: selected.element, pageUrl: selected.pageUrl }) as ServerMessage;
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
    const response = await chrome.runtime.sendMessage({ type: recording ? "ui.recording.stop" : "ui.recording.start" }) as { active?: boolean; startUrl?: string; actions?: RecordedBrowserAction[]; error?: string };
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
    if (!recordedActions.length || !confirm(`Replay ${recordedActions.length} action(s) on the current page?`)) return;
    const response = await chrome.runtime.sendMessage({ type: "ui.recording.replay", actions: recordedActions }) as { ok?: boolean; error?: string };
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
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <img src="assets/icon-48.png" className="h-8 w-8 rounded-[10px]" alt="" />
          <div className="min-w-0"><h1 className="truncate text-[15px] font-semibold">Auto Page Agent</h1><p className="truncate text-[10px] text-slate-400">Current-page agent</p></div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${health?.ok ? "bg-emerald-500" : "bg-amber-400"}`} title={health?.agent.error ?? health?.agent.name ?? "Bridge unavailable"} />
          <IconButton label="New conversation" onClick={() => void newConversation()}><SquarePen size={17} /></IconButton>
        </div>
      </header>

      <nav className="flex shrink-0 items-center justify-between border-b border-slate-200/70 bg-white px-3 py-2" aria-label="Page tools">
        <div className="flex items-center gap-1">
          <ToolButton active={selectionMode === "element"} label="Select" title="Select an element" onClick={() => void startSelection("element")}><MousePointer2 size={16} /></ToolButton>
          <ToolButton active={selectionMode === "image"} label="Image" title="Select an image" onClick={() => void startSelection("image")}><Image size={16} /></ToolButton>
          <ToolButton active={Boolean(screenshot)} label="Capture" title="Capture viewport" onClick={() => void captureScreenshot()}><Camera size={16} /></ToolButton>
          <ToolButton label="Skills" title="Open Skills" onClick={() => setModal("skills")}><Sparkles size={16} /></ToolButton>
        </div>
        <ToolButton active={recording} label={recording ? "Stop" : "Record"} title="Record a reusable workflow" onClick={() => void toggleRecording()}>{recording ? <CircleStop size={16} /> : <Play size={16} />}</ToolButton>
      </nav>

      <section ref={threadRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {!messages.length && !busy ? <EmptyState onPick={() => void startSelection("element")} onSkills={() => setModal("skills")} /> : null}
        <div className="space-y-5">
          {messages.map((message) => <Message key={message.id} message={message} />)}
          {busy ? <div className="flex items-center gap-2 text-xs text-slate-400"><LoaderCircle className="animate-spin" size={15} />Agent is working on the page…</div> : null}
        </div>

        {selected ? <ContextCard selected={selected.element} onClose={() => void clearContext()} onAnalyze={() => void analyzeCode()} /> : null}
        {screenshot ? <ScreenshotCard screenshot={screenshot} onClose={() => setScreenshot(null)} /> : null}
        {events.length ? <Timeline events={events} /> : null}
      </section>

      <div className="shrink-0 px-3 pb-3">
        {pendingPlan ? <ApprovalCard plan={pendingPlan} onCancel={() => setPendingPlan(null)} onConfirm={() => void executePlan()} /> : null}
        <form onSubmit={(event) => void submitTask(event)} className="rounded-[22px] border border-slate-200 bg-white p-3 shadow-[0_12px_40px_rgba(15,23,42,.10)] focus-within:border-violet-300">
          {contextLabel ? <div className="mb-2 flex"><span className="flex max-w-full items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600"><MousePointer2 size={12} /><span className="truncate">{contextLabel}</span><button type="button" onClick={() => void clearContext()} aria-label="Remove context"><X size={12} /></button></span></div> : null}
          <textarea ref={inputRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitTask(); } }} rows={2} placeholder="Ask about this page or tell the agent what to do…" className="max-h-32 min-h-12 w-full resize-none border-0 bg-transparent px-1 text-[14px] leading-5 outline-none placeholder:text-slate-400" />
          <div className="mt-1 flex items-center justify-between">
            <div className="flex gap-1"><IconButton label="Select element" onClick={() => void startSelection("element")}><MousePointer2 size={16} /></IconButton><IconButton label="Open Skills" onClick={() => setModal("skills")}><Sparkles size={16} /></IconButton></div>
            <button type="submit" disabled={!prompt.trim() || busy} className="grid h-10 w-10 place-items-center rounded-full bg-slate-950 text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:bg-slate-200" aria-label="Send"><Send size={17} /></button>
          </div>
        </form>
        <p className="mt-1.5 truncate px-2 text-center text-[10px] text-slate-400">{notice}</p>
      </div>

      {modal === "skills" ? <SkillsModal view={skillView} setView={setSkillView} scope={skillScope} items={activeSkills} onClose={() => setModal(null)} onRefresh={() => void refreshSkills()} onUse={chooseSkill} onInstall={(slug, update) => void installSkill(slug, update)} onToggle={(slug, enabled) => void configureSkill(slug, enabled)} onEdit={(slug) => void editSkill(slug)} /> : null}
      {modal === "recording" ? <RecordingModal active={recording} actions={recordedActions} name={skillName} description={skillDescription} editing={Boolean(editingSkillSlug)} onName={setSkillName} onDescription={setSkillDescription} onClose={() => setModal(null)} onToggle={() => void toggleRecording()} onReplay={() => void replayRecording()} onSave={() => void saveSkill()} /> : null}
    </main>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} title={label} aria-label={label} className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">{children}</button>;
}

function ToolButton({ label, title, active = false, onClick, children }: { label: string; title: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} title={title} className={`flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-[11px] font-medium transition ${active ? "bg-violet-50 text-violet-700 ring-1 ring-violet-200" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"}`}>{children}<span className="hidden min-[430px]:inline">{label}</span></button>;
}

function EmptyState({ onPick, onSkills }: { onPick: () => void; onSkills: () => void }) {
  return <div className="mx-auto flex max-w-[310px] flex-col items-center py-12 text-center"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-50 text-violet-600"><WandSparkles size={23} /></span><h2 className="mt-4 text-base font-semibold">What should we do here?</h2><p className="mt-1.5 text-xs leading-5 text-slate-500">Ask about the current page, select an element for context, or run a reusable Skill.</p><div className="mt-4 flex gap-2"><button onClick={onPick} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:border-violet-300">Select element</button><button onClick={onSkills} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:border-violet-300">Browse Skills</button></div></div>;
}

function Message({ message }: { message: ChatMessage }) {
  const assistant = message.role === "assistant";
  return <article className={`group flex gap-2.5 ${assistant ? "items-start" : "justify-end"}`}>{assistant ? <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-950 text-white"><Bot size={14} /></span> : null}<div className={`${assistant ? "max-w-[calc(100%-38px)] text-slate-700" : "max-w-[86%] rounded-2xl rounded-br-md bg-slate-200/70 px-3.5 py-2.5 text-slate-900"}`}><div className="whitespace-pre-wrap text-[13px] leading-[1.65]">{message.content}</div><button type="button" onClick={() => void navigator.clipboard.writeText(message.content)} className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-400 opacity-0 transition group-hover:opacity-100"><Copy size={11} />Copy</button></div></article>;
}

function ContextCard({ selected, onClose, onAnalyze }: { selected: InspectedElement; onClose: () => void; onAnalyze: () => void }) {
  return <aside className="mt-5 rounded-2xl border border-violet-100 bg-violet-50/60 p-3"><div className="flex items-start gap-3">{selected.image?.src ? <img src={selected.image.src} className="h-14 w-14 rounded-xl object-cover" alt={selected.image.alt} /> : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-violet-600"><MousePointer2 size={17} /></span>}<div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><strong className="truncate text-xs">Selected &lt;{selected.tagName}&gt;</strong><button onClick={onClose} aria-label="Remove selection"><X size={14} /></button></div><p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{selected.label || selected.text || selected.nearbyText || "No visible text"}</p><button onClick={onAnalyze} className="mt-2 flex items-center gap-1 text-[11px] font-medium text-violet-700"><Code2 size={13} />Find in repositories</button></div></div></aside>;
}

function ScreenshotCard({ screenshot, onClose }: { screenshot: { dataUrl: string; title: string; url: string }; onClose: () => void }) {
  return <aside className="relative mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white"><img src={screenshot.dataUrl} className="max-h-48 w-full object-cover object-top" alt={screenshot.title} /><button onClick={onClose} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-white/90 shadow" aria-label="Remove screenshot"><X size={14} /></button><div className="truncate px-3 py-2 text-[10px] text-slate-500">{screenshot.title} · local capture</div></aside>;
}

function Timeline({ events }: { events: AgentEvent[] }) {
  const [open, setOpen] = useState(false);
  return <aside className="mt-5 rounded-2xl border border-slate-200 bg-white"><button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[11px] font-medium"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-violet-500" />Agent activity · {events.length}</span><ChevronDown size={14} className={open ? "rotate-180" : ""} /></button>{open ? <ol className="max-h-48 space-y-2 overflow-auto border-t border-slate-100 px-3 py-3">{events.map((event) => <li key={event.id} className="flex gap-2 text-[10px] leading-4 text-slate-500"><Check size={12} className="mt-0.5 shrink-0 text-violet-500" /><span>{eventLabel(event)}</span></li>)}</ol> : null}</aside>;
}

function ApprovalCard({ plan, onCancel, onConfirm }: { plan: BrowserActionPlan; onCancel: () => void; onConfirm: () => void }) {
  return <aside className="mb-2 rounded-2xl border border-violet-200 bg-white p-3 shadow-lg"><div className="flex items-start gap-2"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600"><MousePointer2 size={16} /></span><div className="min-w-0 flex-1"><strong className="text-xs">Ready to act on this page</strong><p className="mt-1 text-[11px] leading-4 text-slate-500">{plan.summary}</p>{plan.steps.map((step, index) => <p key={index} className="mt-1.5 rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] text-slate-600">{step.action} · {step.reason}</p>)}</div></div><div className="mt-3 flex justify-end gap-2"><button onClick={onCancel} className="rounded-xl px-3 py-2 text-xs text-slate-500 hover:bg-slate-100">Cancel</button><button onClick={onConfirm} className="flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2 text-xs font-medium text-white hover:bg-violet-600"><Play size={13} />Run & verify</button></div></aside>;
}

function SkillsModal(props: { view: SkillView; setView: (view: SkillView) => void; scope: string; items: Array<PageSkillSummary | SkillCatalogItem>; onClose: () => void; onRefresh: () => void; onUse: (skill: Pick<SkillCatalogItem, "name" | "description">, debug?: boolean) => void; onInstall: (slug: string, update: boolean) => void; onToggle: (slug: string, enabled: boolean) => void; onEdit: (slug: string) => void }) {
  return <ModalShell title="Skills" subtitle="Reusable page actions" onClose={props.onClose} action={<IconButton label="Refresh Skills" onClick={props.onRefresh}><RefreshCw size={15} /></IconButton>}><div className="grid grid-cols-3 rounded-xl bg-slate-100 p-1">{(["page", "installed", "marketplace"] as const).map((view) => <button key={view} onClick={() => props.setView(view)} className={`rounded-lg px-2 py-2 text-[11px] font-medium capitalize ${props.view === view ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{view === "page" ? "This page" : view === "installed" ? "My Skills" : "Explore"}</button>)}</div><p className="px-1 pt-3 text-[10px] text-slate-400">{props.view === "page" ? props.scope : `${props.items.length} Skills`}</p><div className="mt-2 space-y-2">{props.items.length ? props.items.map((skill) => <SkillRow key={skill.slug} skill={skill} view={props.view} onUse={props.onUse} onInstall={props.onInstall} onToggle={props.onToggle} onEdit={props.onEdit} />) : <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-xs text-slate-400">No Skills here yet.</p>}</div></ModalShell>;
}

function SkillRow({ skill, view, onUse, onInstall, onToggle, onEdit }: { skill: PageSkillSummary | SkillCatalogItem; view: SkillView; onUse: (skill: Pick<SkillCatalogItem, "name" | "description">, debug?: boolean) => void; onInstall: (slug: string, update: boolean) => void; onToggle: (slug: string, enabled: boolean) => void; onEdit: (slug: string) => void }) {
  const pageSkill = "enabled" in skill ? skill : null;
  const catalogSkill = "installed" in skill ? skill : null;
  return <article className={`rounded-2xl border border-slate-200 bg-white p-3 ${pageSkill && !pageSkill.enabled ? "opacity-55" : ""}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><strong className="block truncate text-xs">{skill.name}</strong><span className="mt-1 inline-block rounded-full bg-violet-50 px-2 py-0.5 text-[9px] text-violet-600">{skill.scope}</span></div>{view === "marketplace" && catalogSkill ? <button disabled={catalogSkill.installed && !catalogSkill.updateAvailable} onClick={() => onInstall(skill.slug, catalogSkill.updateAvailable)} className="rounded-lg bg-slate-950 px-2.5 py-1.5 text-[10px] font-medium text-white disabled:bg-slate-100 disabled:text-slate-400">{catalogSkill.updateAvailable ? "Update" : catalogSkill.installed ? "Installed" : "Install"}</button> : <button disabled={Boolean(pageSkill && !pageSkill.enabled)} onClick={() => onUse(skill)} className="rounded-lg bg-slate-950 px-2.5 py-1.5 text-[10px] font-medium text-white disabled:bg-slate-200">Use</button>}</div><p className="mt-2 text-[11px] leading-4 text-slate-500">{skill.description}</p>{view !== "marketplace" ? <div className="mt-2 flex gap-3 text-[10px] text-slate-400"><button onClick={() => onUse(skill, true)}>Debug</button>{pageSkill?.configurable ? <><button onClick={() => onToggle(skill.slug, !pageSkill.enabled)}>{pageSkill.enabled ? "Disable" : "Enable"}</button><button onClick={() => onEdit(skill.slug)}>Edit</button></> : catalogSkill?.stepCount ? <button onClick={() => onEdit(skill.slug)}>Edit</button> : null}</div> : null}</article>;
}

function RecordingModal(props: { active: boolean; actions: RecordedBrowserAction[]; name: string; description: string; editing: boolean; onName: (value: string) => void; onDescription: (value: string) => void; onClose: () => void; onToggle: () => void; onReplay: () => void; onSave: () => void }) {
  return <ModalShell title={props.active ? "Recording workflow" : props.editing ? "Edit Skill" : "Recorded workflow"} subtitle={`${props.actions.length} captured steps`} onClose={props.onClose}><button onClick={props.onToggle} className={`flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium ${props.active ? "bg-rose-50 text-rose-700" : "bg-slate-950 text-white"}`}>{props.active ? <CircleStop size={15} /> : <Play size={15} />}{props.active ? "Stop recording" : "Start recording"}</button><ol className="mt-3 max-h-40 space-y-1.5 overflow-auto">{props.actions.map((action) => <li key={action.id} className="rounded-lg bg-slate-50 px-2.5 py-2 text-[10px] text-slate-600">{action.action} · {action.label || action.selector || "page"}</li>)}</ol><label className="mt-3 block text-[10px] font-medium text-slate-500">Skill name<input value={props.name} onChange={(event) => props.onName(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-violet-300" /></label><label className="mt-3 block text-[10px] font-medium text-slate-500">Description<textarea value={props.description} onChange={(event) => props.onDescription(event.target.value)} rows={2} className="mt-1 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-violet-300" /></label><div className="mt-4 flex justify-end gap-2"><button onClick={props.onReplay} disabled={!props.actions.length} className="rounded-xl px-3 py-2 text-xs text-slate-500 disabled:opacity-40">Test replay</button><button onClick={props.onSave} disabled={!props.actions.length || props.active} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-medium text-white disabled:bg-slate-200">{props.editing ? "Update Skill" : "Save Skill"}</button></div></ModalShell>;
}

function ModalShell({ title, subtitle, onClose, action, children }: { title: string; subtitle: string; onClose: () => void; action?: React.ReactNode; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-end bg-slate-950/20 p-2 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="max-h-[86vh] w-full overflow-y-auto rounded-[24px] border border-slate-200 bg-[#f8f9fb] p-4 shadow-2xl"><header className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold">{title}</h2><p className="text-[10px] text-slate-400">{subtitle}</p></div><div className="flex items-center gap-1">{action}<IconButton label="Close" onClick={onClose}><X size={17} /></IconButton></div></header>{children}</section></div>;
}

function eventLabel(event: AgentEvent): string {
  if (event.type === "observe") return `Observe · ${event.summary || event.snapshotId}`;
  if (event.type === "thinking") return event.delta ? `Thinking · ${event.content.replace(/\s+/gu, " ").slice(0, 120)}` : event.content;
  if (event.type === "plan") return `Plan · ${event.summary}`;
  if (event.type === "action") return `${event.status === "running" ? "Act" : "Action"} · ${event.action}${event.detail ? ` · ${event.detail}` : ""}`;
  if (event.type === "verify") return `Verify · ${event.summary}`;
  if (event.type === "complete") return `Complete · ${event.summary}`;
  return `Error · ${event.error}`;
}

function formatRepositoryAnalysis(analysis: RepositoryAnalysis) {
  const evidence = analysis.evidence.map((item, index) => `${index + 1}. [${item.confidence}/${item.kind}] ${item.repository}/${item.path}:${item.line}\n   ${item.preview}`).join("\n\n");
  return [`Repositories: ${analysis.repositories.join(", ") || "none configured"}`, analysis.warnings.length ? `Warnings: ${analysis.warnings.join(" ")}` : "", evidence || "No repository evidence found."].filter(Boolean).join("\n\n");
}

function defaultSkillName(url: string) { try { return `${new URL(url).hostname} workflow`; } catch { return "Recorded browser workflow"; } }

createRoot(document.querySelector("#root")!).render(<App />);
