import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Camera, CircleStop, History, Image, LoaderCircle, MousePointer2, Play, Plus,
  Send, Sparkles, X,
} from "lucide-react";
import type {
  AgentEvent, AgentNeedsUser, AutomationSkillDraft, BrowserActionPlan, BrowserTabTarget, ChatMessage,
  ConversationLog, ConversationLogSummary, ConversationLogTarget, EditableAutomationSkill, InspectedElement, PageSkillSummary,
  RecordedBrowserAction, RecordedPageScreenshot, RepositoryAnalysis, ServerMessage, SkillCatalogItem, SkillExportBundle,
} from "@auto-page-agent/shared";
import { defaultSkillName, formatRepositoryAnalysis } from "./formatters.js";
import { ApprovalCard, ChoiceCard, ComposerToolButton, ConnectionGate, ContextCard, EmptyState, HistoryModal, Message, RecordingModal, ScreenshotCard, SkillsModal, TargetTabHeader, Timeline, type SkillView } from "./components.js";
import { Button } from "../components/ui/button.js";
import {
  completedConversationMessage,
  composeAgentTask,
  createConversationLog,
  conversationStorageKey,
  legacyConversationSession,
  LEGACY_CONVERSATION_STORAGE_KEYS,
  normalizeConversationSession,
  summarizeMessageContext,
  toAgentHistory,
} from "./conversation.js";

type Modal = "history" | "skills" | "recording" | null;
type ConversationScope = { conversationId: string; targetTabId: number; windowId: number };
type ConnectionState =
  | { phase: "checking"; title: string; message: string }
  | { phase: "disconnected" | "codex-missing" | "login-required"; title: string; message: string }
  | { phase: "ready"; title: string; message: string; provider: string };

export function SidePanelController() {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [historyLogs, setHistoryLogs] = useState<ConversationLogSummary[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(() => t("notice.ready"));
  const [pendingPlan, setPendingPlan] = useState<BrowserActionPlan | null>(null);
  const [pendingChoice, setPendingChoice] = useState<AgentNeedsUser | null>(null);
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
  const [skillScope, setSkillScope] = useState(() => t("skills.currentPage"));
  const [catalog, setCatalog] = useState<{ installed: SkillCatalogItem[]; marketplace: SkillCatalogItem[] }>({ installed: [], marketplace: [] });
  const [recording, setRecording] = useState(false);
  const [recordedActions, setRecordedActions] = useState<RecordedBrowserAction[]>([]);
  const [recordedScreenshots, setRecordedScreenshots] = useState<RecordedPageScreenshot[]>([]);
  const [recordingStartUrl, setRecordingStartUrl] = useState("");
  const [skillName, setSkillName] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [skillInstructions, setSkillInstructions] = useState("");
  const [editingSkillSlug, setEditingSkillSlug] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<{ slug: string; name: string } | null>(null);
  const [tabs, setTabs] = useState<BrowserTabTarget[]>([]);
  const [targetTab, setTargetTab] = useState<BrowserTabTarget | null>(null);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>({
    phase: "checking",
    title: t("connection.connectingTitle"),
    message: t("connection.startingBridge"),
  });
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const eventsRef = useRef<AgentEvent[]>([]);
  const targetTabRef = useRef<BrowserTabTarget | null>(null);
  const conversationTargetRef = useRef<ConversationLogTarget>({ title: "", url: "" });
  const conversationIdRef = useRef<string>(crypto.randomUUID());
  const conversationCreatedAtRef = useRef(new Date().toISOString());
  const conversationRevisionRef = useRef(0);
  const windowIdRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const activeTaskRef = useRef("");
  const pendingUserTaskRef = useRef<string | null>(null);
  const pendingChoiceRef = useRef<AgentNeedsUser | null>(null);
  const selectedSkillRef = useRef<{ slug: string; name: string } | null>(null);

  useEffect(() => {
    void initialize();
    const listener = (message: unknown) => {
      const value = message as { type?: string; element?: InspectedElement; pageUrl?: string; tabId?: number; windowId?: number; targetTabId?: number; screenshot?: { dataUrl: string; title: string; url: string }; screenshots?: RecordedPageScreenshot[]; reason?: string; error?: string; actions?: RecordedBrowserAction[]; event?: AgentEvent; conversationId?: string };
      if (typeof value.windowId === "number" && value.windowId !== windowIdRef.current) return;
      if (value.type === "ui.element.selected" && value.element && value.tabId === targetTabRef.current?.tabId) {
        setSelected({ element: value.element, pageUrl: value.pageUrl ?? "", screenshot: value.screenshot });
        setSelectionMode(null);
        setNotice(value.screenshot
          ? t("notice.selectedCapture", { tag: value.element.tagName })
          : t("notice.selectedElement", { tag: value.element.tagName }));
      }
      if (value.type === "ui.selection.cancelled") {
        setSelectionMode(null);
        setNotice(value.reason || t("notice.selectionCancelled"));
      }
      if (value.type === "ui.recording.updated") {
        setRecordedActions(value.actions ?? []);
        setRecordedScreenshots(value.screenshots ?? []);
      }
      if (value.type === "ui.bridge.disconnected") {
        setConnection({
          phase: "disconnected",
          title: t("connection.disconnectedTitle"),
          message: value.error || t("connection.reconnectBridge"),
        });
        setNotice(t("notice.bridgeDisconnected"));
      }
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
    if (typeof currentWindow.id !== "number") throw new Error(t("notice.currentWindowUnavailable"));
    windowIdRef.current = currentWindow.id;
    const storageKey = conversationStorageKey(currentWindow.id);
    const [stored, tabState, connected] = await Promise.all([
      chrome.storage.session.get([storageKey, ...LEGACY_CONVERSATION_STORAGE_KEYS]),
      chrome.runtime.sendMessage({ type: "ui.tabs.list", windowId: currentWindow.id }) as Promise<{ tabs?: BrowserTabTarget[]; activeTabId?: number; windowId?: number }>,
      checkConnection(false),
    ]);
    const availableTabs = tabState.tabs ?? [];
    const session = normalizeConversationSession(stored[storageKey]) ?? legacyConversationSession(stored);
    const storedMessages = session?.messages ?? [];
    const storedEvents = session?.events ?? [];
    const initialTarget = session
      ? availableTabs.find((tab) => tab.tabId === session.targetTabId) ?? null
      : availableTabs.find((tab) => tab.tabId === tabState.activeTabId) ?? null;
    const initialConversationId = session?.conversationId ?? crypto.randomUUID();
    conversationIdRef.current = initialConversationId;
    conversationCreatedAtRef.current = session?.createdAt ?? new Date().toISOString();
    conversationRevisionRef.current = session?.revision ?? 0;
    pendingUserTaskRef.current = session?.pendingTask ?? null;
    pendingChoiceRef.current = session?.pendingChoice ?? null;
    selectedSkillRef.current = session?.selectedSkill ?? null;
    setMessages(storedMessages);
    messagesRef.current = storedMessages;
    setEvents(storedEvents);
    eventsRef.current = storedEvents;
    setPendingChoice(session?.pendingChoice ?? null);
    setSelectedSkill(session?.selectedSkill ?? null);
    setTabs(availableTabs);
    setActiveTabId(tabState.activeTabId ?? null);
    if (connected && session) {
      const logResponse = await chrome.runtime.sendMessage({
        type: "ui.logs.get",
        conversationId: initialConversationId,
      }).catch(() => undefined) as ServerMessage | undefined;
      if (logResponse?.type === "log.detail") conversationTargetRef.current = logResponse.log.target;
    }
    setTargetTabValue(initialTarget);
    await persistConversation(initialConversationId, storedMessages, initialTarget?.tabId, storedEvents);
    if (!stored[storageKey]) await chrome.storage.session.remove([...LEGACY_CONVERSATION_STORAGE_KEYS]);
    await Promise.all([
      initialTarget ? restoreSelection(initialTarget.tabId) : Promise.resolve(),
      restoreRecording(),
      connected ? refreshSkills(initialTarget?.tabId) : Promise.resolve(),
      connected ? refreshLogs() : Promise.resolve(),
    ]);
    if (!initialTarget) {
      setNotice(session
        ? t("notice.conversationPageClosed")
        : t("notice.openPageThenNew"));
    }
  }

  async function checkConnection(reconnect: boolean): Promise<boolean> {
    setConnection({
      phase: "checking",
      title: reconnect ? t("connection.reconnectingTitle") : t("connection.connectingTitle"),
      message: t("connection.startingBridge"),
    });
    const response = await chrome.runtime.sendMessage({ type: reconnect ? "ui.bridge.reconnect" : "ui.health" }) as ServerMessage;
    if (response.type === "agent.error") {
      setConnection({ phase: "disconnected", title: t("connection.notConnectedTitle"), message: response.error });
      setNotice(t("notice.registerBridge"));
      return false;
    }
    if (response.type !== "health.result") {
      setConnection({ phase: "disconnected", title: t("connection.notConnectedTitle"), message: t("connection.unexpectedBridge") });
      return false;
    }
    if (!response.codex.available) {
      setConnection({
        phase: "codex-missing",
        title: t("connection.codexMissingTitle"),
        message: response.codex.error || t("connection.installCodex"),
      });
      setNotice(t("notice.codexRequired"));
      return false;
    }
    if (!response.codex.authenticated) {
      setConnection({
        phase: "login-required",
        title: t("connection.loginRequiredTitle"),
        message: response.codex.error || t("connection.loginInstructions"),
      });
      setNotice(t("notice.codexLoginRequired"));
      return false;
    }
    setConnection({ phase: "ready", title: t("connection.connectedTitle"), message: t("connection.ready"), provider: response.provider });
    setNotice(t("notice.connectedProvider", { provider: response.provider }));
    if (reconnect) {
      await Promise.all([
        refreshSkills(targetTabRef.current?.tabId),
        persistConversation(conversationIdRef.current, messagesRef.current),
        refreshLogs(),
      ]);
    }
    return true;
  }

  async function persistConversation(
    id: string,
    next: ChatMessage[],
    targetTabId = targetTabRef.current?.tabId,
    nextEvents = eventsRef.current,
  ) {
    const windowId = windowIdRef.current;
    if (typeof windowId !== "number") return;
    const revision = ++conversationRevisionRef.current;
    const target = targetTabRef.current?.tabId === targetTabId
      ? targetTabRef.current
      : tabs.find((tab) => tab.tabId === targetTabId) ?? null;
    if (target) {
      conversationTargetRef.current = {
        tabId: target.tabId,
        title: target.title,
        url: target.url,
      };
    }
    await chrome.storage.session.set({
      [conversationStorageKey(windowId)]: {
        conversationId: id,
        messages: next.slice(-40),
        events: nextEvents.slice(-80),
        createdAt: conversationCreatedAtRef.current,
        revision,
        ...(typeof targetTabId === "number" ? { targetTabId } : {}),
        ...(pendingUserTaskRef.current ? { pendingTask: pendingUserTaskRef.current } : {}),
        ...(pendingChoiceRef.current ? { pendingChoice: pendingChoiceRef.current } : {}),
        ...(selectedSkillRef.current ? { selectedSkill: selectedSkillRef.current } : {}),
      },
    });
    if (!next.length && !nextEvents.length) return;
    const log = createConversationLog({
      conversationId: id,
      messages: next,
      events: nextEvents,
      createdAt: conversationCreatedAtRef.current,
      revision,
      windowId,
      target: target ?? conversationTargetRef.current,
      pendingTask: pendingUserTaskRef.current,
      pendingChoice: pendingChoiceRef.current,
      selectedSkill: selectedSkillRef.current,
      fallbackTitle: t("history.untitled"),
    });
    const response = await chrome.runtime.sendMessage({ type: "ui.logs.save", log }).catch(() => undefined) as ServerMessage | undefined;
    if (response?.type === "log.saved") {
      setHistoryLogs((current) => [
        response.summary,
        ...current.filter((item) => item.conversationId !== response.summary.conversationId),
      ].slice(0, 100));
    }
  }

  function appendMessage(role: ChatMessage["role"], content: string, attachments?: ChatMessage["attachments"]) {
    setMessages((current) => {
      const next = [...current, { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString(), ...(attachments ? { attachments } : {}) }].slice(-40);
      messagesRef.current = next;
      void persistConversation(conversationIdRef.current, next);
      return next;
    });
  }

  function appendEvent(event: AgentEvent) {
    setEvents((current) => {
      const next = [...current, event].slice(-80);
      eventsRef.current = next;
      void persistConversation(conversationIdRef.current, messagesRef.current, targetTabRef.current?.tabId, next);
      return next;
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
    const state = await chrome.runtime.sendMessage({ type: "ui.recording.status" }) as { active?: boolean; startUrl?: string; actions?: RecordedBrowserAction[]; screenshots?: RecordedPageScreenshot[] };
    setRecording(Boolean(state.active));
    setRecordingStartUrl(state.startUrl ?? "");
    setRecordedActions(state.actions ?? []);
    setRecordedScreenshots(state.screenshots ?? []);
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
      try { setSkillScope(`${new URL(pageResponse.pageUrl).hostname} · ${t("skills.available", { count: pageResponse.skills.length })}`); }
      catch { setSkillScope(t("skills.available", { count: pageResponse.skills.length })); }
    }
    if (catalogResponse?.type === "skill.catalog.result") setCatalog({ installed: catalogResponse.installed, marketplace: catalogResponse.marketplace });
  }

  async function refreshLogs() {
    const response = await chrome.runtime.sendMessage({ type: "ui.logs.list" }) as ServerMessage;
    if (response.type === "log.list.result") setHistoryLogs(response.logs);
  }

  async function refreshTabs() {
    const windowId = windowIdRef.current;
    if (typeof windowId !== "number") return;
    const response = await chrome.runtime.sendMessage({ type: "ui.tabs.list", windowId }) as { tabs?: BrowserTabTarget[]; activeTabId?: number; windowId?: number };
    const availableTabs = response.tabs ?? [];
    setTabs(availableTabs);
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
      setNotice(t("notice.conversationPageClosed"));
      return;
    }
    if (refreshed.url !== current.url) void refreshSkills(refreshed.tabId);
  }

  function setTargetTabValue(tab: BrowserTabTarget | null) {
    targetTabRef.current = tab;
    if (tab) {
      conversationTargetRef.current = {
        tabId: tab.tabId,
        title: tab.title,
        url: tab.url,
      };
    }
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
    conversationCreatedAtRef.current = new Date().toISOString();
    conversationRevisionRef.current = 0;
    conversationTargetRef.current = activeTarget
      ? { tabId: activeTarget.tabId, title: activeTarget.title, url: activeTarget.url }
      : { title: "", url: "" };
    messagesRef.current = [];
    eventsRef.current = [];
    setMessages([]);
    setEvents([]);
    setPendingPlan(null);
    pendingChoiceRef.current = null;
    setPendingChoice(null);
    setSelected(null);
    setScreenshot(null);
    setPrompt("");
    selectedSkillRef.current = null;
    setSelectedSkill(null);
    activeTaskRef.current = "";
    pendingUserTaskRef.current = null;
    setActiveTabId(tabState.activeTabId ?? null);
    setTargetTabValue(activeTarget);
    setNotice(activeTarget
      ? t("notice.newConversation")
      : t("notice.openPageThenNew"));
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

  async function openHistory() {
    if (connection.phase === "ready") await refreshLogs().catch(() => undefined);
    setModal("history");
  }

  async function switchHistory(summary: ConversationLogSummary) {
    if (busyRef.current || summary.conversationId === conversationIdRef.current) {
      setModal(null);
      return;
    }
    await persistConversation(conversationIdRef.current, messagesRef.current);
    const response = await chrome.runtime.sendMessage({
      type: "ui.logs.get",
      conversationId: summary.conversationId,
    }) as ServerMessage;
    if (response.type !== "log.detail") {
      setNotice(response.type === "agent.error" ? response.error : t("notice.historyLoadFailed"));
      return;
    }
    restoreConversationLog(response.log);
    setModal(null);
  }

  function restoreConversationLog(log: ConversationLog) {
    const restoredTarget = typeof log.target.tabId === "number"
      ? tabs.find((tab) => tab.tabId === log.target.tabId) ?? null
      : null;
    conversationIdRef.current = log.conversationId;
    conversationCreatedAtRef.current = log.createdAt;
    conversationRevisionRef.current = log.revision;
    messagesRef.current = log.messages;
    eventsRef.current = log.events;
    pendingUserTaskRef.current = log.pendingTask ?? null;
    pendingChoiceRef.current = log.pendingChoice ?? null;
    selectedSkillRef.current = log.selectedSkill ?? null;
    conversationTargetRef.current = log.target;
    setMessages(log.messages);
    setEvents(log.events);
    setPendingPlan(null);
    setPendingChoice(log.pendingChoice ?? null);
    setSelectedSkill(log.selectedSkill ?? null);
    setSelected(null);
    setScreenshot(null);
    setPrompt("");
    activeTaskRef.current = "";
    setTargetTabValue(restoredTarget);
    setNotice(restoredTarget ? t("notice.historyLoaded") : t("notice.historyPageUnavailable"));
    void persistConversation(log.conversationId, log.messages, restoredTarget?.tabId, log.events);
    if (restoredTarget) {
      void Promise.all([restoreSelection(restoredTarget.tabId), refreshSkills(restoredTarget.tabId)]);
    }
  }

  async function deleteHistory(conversationId: string) {
    const response = await chrome.runtime.sendMessage({
      type: "ui.logs.delete",
      conversationId,
    }) as ServerMessage;
    if (response.type !== "log.deleted") {
      setNotice(response.type === "agent.error" ? response.error : t("notice.historyDeleteFailed"));
      return;
    }
    setHistoryLogs((current) => current.filter((item) => item.conversationId !== conversationId));
    if (conversationId === conversationIdRef.current) {
      setModal(null);
      await newConversation();
    }
  }

  async function startSelection(mode: "element" | "image") {
    if (!targetTab) return setNotice(t("notice.chooseTarget"));
    setSelectionMode(mode);
    setNotice(mode === "image" ? t("notice.selectForCapture") : t("notice.selectElement"));
    const response = await chrome.runtime.sendMessage({ type: "ui.selection.start", mode, targetTabId: targetTab.tabId }) as { ok?: boolean; error?: string };
    if (!response?.ok) {
      setSelectionMode(null);
      setNotice(t("notice.selectionFailed", { error: response?.error ?? t("notice.selectionFallback") }));
    }
  }

  async function captureScreenshot() {
    if (!targetTab) return setNotice(t("notice.chooseTarget"));
    setNotice(t("notice.capturing"));
    const response = await chrome.runtime.sendMessage({ type: "ui.screenshot.capture", targetTabId: targetTab.tabId }) as { ok?: boolean; dataUrl?: string; title?: string; url?: string; error?: string };
    if (!response.ok || !response.dataUrl) return setNotice(t("notice.screenshotFailed", { error: response.error ?? t("notice.unknownError") }));
    setScreenshot({ dataUrl: response.dataUrl, title: response.title || t("tab.current"), url: response.url || "" });
    setNotice(t("notice.screenshotCaptured"));
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

  async function submitTask(event?: React.FormEvent, confirmedChoice?: string) {
    event?.preventDefault();
    const text = confirmedChoice?.trim() || prompt.trim();
    if (!text || busy) return;
    if (connection.phase !== "ready") return setNotice(t("notice.reconnectBeforeSend"));
    if (!targetTab) return setNotice(t("notice.chooseTarget"));
    const scope: ConversationScope = {
      conversationId: conversationIdRef.current,
      targetTabId: targetTab.tabId,
      windowId: targetTab.windowId,
    };
    const task = composeAgentTask(text, pendingUserTaskRef.current);
    activeTaskRef.current = task;
    pendingUserTaskRef.current = null;
    pendingChoiceRef.current = null;
    setPendingChoice(null);
    const history = toAgentHistory(messages.slice(-20));
    const attachments = summarizeMessageContext(selected, screenshot, {
      noVisibleText: t("attachment.noVisibleText"),
      currentPage: t("tab.current"),
    });
    setEvents([]);
    appendMessage("user", text, attachments);
    setPrompt("");
    setBusyValue(true);
    stopRequestedRef.current = false;
    setPendingPlan(null);
    setNotice(t("notice.agentWorking"));
    try {
      const response = await chrome.runtime.sendMessage({
        type: "ui.run", task, history, ...scope,
        ...(screenshot ? { screenshot: { dataUrl: screenshot.dataUrl, title: screenshot.title, url: screenshot.url } } : {}),
        ...(selectedSkill ? { selectedSkillSlug: selectedSkill.slug } : {}),
      }) as ServerMessage;
      if (stopRequestedRef.current || !isCurrentScope(scope)) return;
      if (response.type === "agent.error") throw new Error(response.error);
      if (response.type !== "agent.result") throw new Error(t("notice.unexpectedBridgeResponse"));
      await clearContext();
      if (response.decision.kind === "action_plan") {
        setPendingPlan(response.decision);
        setNotice(t("notice.actionReady"));
      } else if (response.decision.kind === "answer") {
        activeTaskRef.current = "";
        appendMessage("assistant", response.decision.content);
        setNotice(t("notice.answeredBy", { provider: response.provider }));
      } else if (response.decision.kind === "complete") {
        activeTaskRef.current = "";
        appendMessage("assistant", response.decision.summary);
        setNotice(t("notice.alreadyComplete"));
      } else if (response.decision.kind === "needs_user") {
        pendingUserTaskRef.current = task;
        if (response.decision.options?.length) {
          pendingChoiceRef.current = response.decision;
          setPendingChoice(response.decision);
          await persistConversation(conversationIdRef.current, messagesRef.current);
          setNotice(t("notice.choiceReady"));
        } else {
          appendMessage("assistant", response.decision.question);
          setNotice(t("notice.needsMoreInformation"));
        }
      } else {
        activeTaskRef.current = "";
        appendMessage("assistant", t("notice.unableToContinue", { reason: response.decision.reason }));
        setNotice(response.decision.reason);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!stopRequestedRef.current) {
        appendMessage("assistant", t("notice.error", { error: message }));
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
    setNotice(t("notice.operatingAndVerifying"));
    try {
      const target = targetTabRef.current;
      const windowId = windowIdRef.current;
      if (!target || typeof windowId !== "number") throw new Error(t("notice.conversationPageClosed"));
      const scope: ConversationScope = { conversationId: conversationIdRef.current, targetTabId: target.tabId, windowId };
      const response = await chrome.runtime.sendMessage({ type: "ui.execute", plan, ...scope }) as {
        ok?: boolean;
        status?: "completed" | "needs_user" | "blocked";
        answer?: string;
        question?: string;
        options?: string[];
        recommendedOption?: string;
        evidence?: string[];
        steps?: number;
        recoverable?: boolean;
        error?: string;
      };
      if (stopRequestedRef.current || !isCurrentScope(scope)) return;
      if (response.status === "needs_user") {
        pendingUserTaskRef.current = activeTaskRef.current;
        if (response.options?.length) {
          const choice: AgentNeedsUser = {
            kind: "needs_user",
            question: response.question ?? t("notice.moreInformationRequired"),
            options: response.options,
            ...(response.recommendedOption ? { recommendedOption: response.recommendedOption } : {}),
          };
          pendingChoiceRef.current = choice;
          setPendingChoice(choice);
          await persistConversation(conversationIdRef.current, messagesRef.current);
          setNotice(t("notice.choiceReady"));
        } else {
          appendMessage("assistant", response.question ?? t("notice.moreInformationRequired"));
          setNotice(t("notice.needsMoreInformation"));
        }
        return;
      }
      if (response.status === "blocked") {
        activeTaskRef.current = "";
        appendMessage("assistant", t("notice.unableToContinue", { reason: response.error ?? t("notice.pageTaskBlocked") }));
        setNotice(response.recoverable ? t("notice.pageChangedRetry") : t("notice.cannotContinueSafely"));
        return;
      }
      if (!response.ok) throw new Error(response.error ?? t("notice.actionFailed"));
      activeTaskRef.current = "";
      appendMessage("assistant", completedConversationMessage(response.answer, t("notice.taskCompletedMessage")));
      setNotice(t("notice.taskCompleted", { count: response.steps ?? 1 }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!stopRequestedRef.current) {
        appendMessage("assistant", t("notice.actionStopped", { error: message }));
        setNotice(message);
      }
    } finally { setBusyValue(false); }
  }

  function cancelChoice() {
    pendingChoiceRef.current = null;
    pendingUserTaskRef.current = null;
    activeTaskRef.current = "";
    setPendingChoice(null);
    setNotice(t("notice.choiceCancelled"));
    void persistConversation(conversationIdRef.current, messagesRef.current);
  }

  async function stopAgent() {
    if (!busyRef.current) return;
    stopRequestedRef.current = true;
    setPendingPlan(null);
    setNotice(t("notice.stoppingAgent"));
    const response = await chrome.runtime.sendMessage({
      type: "ui.agent.stop",
      conversationId: conversationIdRef.current,
      targetTabId: targetTabRef.current?.tabId,
      windowId: windowIdRef.current,
    }) as { ok?: boolean; stopped?: boolean; error?: string };
    setNotice(response.ok ? t("notice.agentStopped") : t("notice.stopFailed", { error: response.error ?? t("notice.unknownError") }));
  }

  async function activateTab(targetTabId: number) {
    setTargetPickerOpen(false);
    await chrome.runtime.sendMessage({ type: "ui.tab.activate", targetTabId }).catch(() => undefined);
  }

  async function analyzeCode() {
    if (!selected || !targetTab) return;
    setNotice(t("notice.searchingRepositories"));
    const response = await chrome.runtime.sendMessage({ type: "ui.repository.analyze", element: selected.element, pageUrl: selected.pageUrl, targetTabId: targetTab.tabId }) as ServerMessage;
    if (response.type === "agent.error") return setNotice(response.error);
    if (response.type !== "repository.result") return setNotice(t("notice.unexpectedRepositoryResponse"));
    appendMessage("assistant", formatRepositoryAnalysis(response.analysis, t));
    setNotice(t("notice.repositoryEvidenceAdded"));
  }

  function chooseSkill(skill: Pick<SkillCatalogItem, "name" | "description" | "slug">, debug = false) {
    const selected = { slug: skill.slug, name: skill.name };
    selectedSkillRef.current = selected;
    setSelectedSkill(selected);
    void persistConversation(conversationIdRef.current, messagesRef.current);
    setPrompt(t("skills.selectedPrompt", {
      action: debug ? t("skills.debugAction") : t("skills.useAction"),
      name: skill.name,
      description: skill.description,
    }).trim());
    setModal(null);
    setNotice(t("notice.skillSelected", { name: skill.name }));
    queueMicrotask(() => inputRef.current?.focus());
  }

  async function installSkill(slug: string, updateAvailable: boolean) {
    if (updateAvailable && !confirm(t("notice.confirmSkillUpdate"))) return;
    const response = await chrome.runtime.sendMessage({ type: "ui.skill.install", slug }) as ServerMessage;
    if (response.type === "agent.error") return setNotice(response.error);
    await refreshSkills();
    setNotice(response.type === "skill.installed" ? t("notice.skillInstalled", { name: response.skill.name }) : t("notice.unexpectedSkillResponse"));
  }

  async function configureSkill(slug: string, enabled: boolean) {
    const response = await chrome.runtime.sendMessage({ type: "ui.skill.configure", slug, enabled }) as ServerMessage;
    if (response.type === "agent.error") return setNotice(response.error);
    await refreshSkills();
  }

  function addSkill() {
    setEditingSkillSlug("");
    setRecording(false);
    setRecordingStartUrl(targetTab?.url ?? "");
    setRecordedActions([]);
    setRecordedScreenshots([]);
    setSkillName(targetTab ? defaultSkillName(targetTab.url, t) : "");
    setSkillDescription("");
    setSkillInstructions("");
    setModal("recording");
  }

  async function importSkill(bundle: SkillExportBundle) {
    const response = await chrome.runtime.sendMessage({ type: "ui.skill.import", bundle }) as ServerMessage;
    if (response.type !== "skill.saved") return setNotice(response.type === "agent.error" ? response.error : t("notice.unexpectedSkillResponse"));
    await refreshSkills();
    setNotice(t("notice.skillImported", { name: response.skill.name }));
  }

  async function exportSkill(slug: string) {
    const response = await chrome.runtime.sendMessage({ type: "ui.skill.export", slug }) as ServerMessage;
    if (response.type !== "skill.exported") return setNotice(response.type === "agent.error" ? response.error : t("notice.unexpectedSkillResponse"));
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(response.bundle, null, 2)}\n`], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = response.filename;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice(t("notice.skillDownloaded"));
  }

  async function deleteSkill(slug: string, name: string) {
    if (!confirm(t("notice.confirmSkillDelete", { name }))) return;
    const response = await chrome.runtime.sendMessage({ type: "ui.skill.delete", slug }) as ServerMessage;
    if (response.type !== "skill.deleted") return setNotice(response.type === "agent.error" ? response.error : t("notice.unexpectedSkillResponse"));
    if (selectedSkillRef.current?.slug === slug) {
      selectedSkillRef.current = null;
      setSelectedSkill(null);
      void persistConversation(conversationIdRef.current, messagesRef.current);
    }
    await refreshSkills();
    setNotice(t("notice.skillDeleted", { name }));
  }

  async function editSkill(slug: string) {
    const response = await chrome.runtime.sendMessage({ type: "ui.skill.get", slug }) as ServerMessage;
    if (response.type !== "skill.detail") return setNotice(response.type === "agent.error" ? response.error : t("notice.unexpectedSkillResponse"));
    const skill: EditableAutomationSkill = response.skill;
    setEditingSkillSlug(skill.slug);
    setRecording(false);
    setRecordingStartUrl(skill.startUrl ?? "");
    setRecordedActions(skill.steps);
    setSkillName(skill.name);
    setSkillDescription(skill.description);
    setSkillInstructions(skill.instructions ?? "");
    setRecordedScreenshots([]);
    setModal("recording");
  }

  async function toggleRecording() {
    if (!recording && !targetTab) return setNotice(t("notice.chooseTarget"));
    if (!recording && modal !== "recording") {
      setEditingSkillSlug("");
      setSkillDescription("");
      setSkillInstructions("");
      setRecordedScreenshots([]);
    }
    const response = await chrome.runtime.sendMessage({ type: recording ? "ui.recording.stop" : "ui.recording.start", targetTabId: targetTab?.tabId }) as { active?: boolean; startUrl?: string; actions?: RecordedBrowserAction[]; screenshots?: RecordedPageScreenshot[]; error?: string };
    if (response.error) return setNotice(response.error);
    const active = !recording;
    setRecording(active);
    setRecordingStartUrl(response.startUrl ?? recordingStartUrl);
    setRecordedActions(response.actions ?? []);
    setRecordedScreenshots(response.screenshots ?? []);
    if (active && !skillName) setSkillName(defaultSkillName(response.startUrl ?? "", t));
    setModal("recording");
    setNotice(active ? t("notice.recordingActive") : t("notice.recordingStopped"));
  }

  async function replayRecording() {
    if (!targetTab) return setNotice(t("notice.chooseTarget"));
    if (!recordedActions.length || !confirm(t("notice.confirmReplay", { count: recordedActions.length }))) return;
    const response = await chrome.runtime.sendMessage({ type: "ui.recording.replay", actions: recordedActions, targetTabId: targetTab.tabId }) as { ok?: boolean; error?: string };
    setNotice(response.ok ? t("notice.replayCompleted") : response.error ?? t("notice.replayFailed"));
  }

  async function captureRecordingScreenshot() {
    if (!recording || !targetTab) return;
    const response = await chrome.runtime.sendMessage({ type: "ui.recording.screenshot", targetTabId: targetTab.tabId }) as { screenshots?: RecordedPageScreenshot[]; error?: string };
    if (response.error) return setNotice(response.error);
    setRecordedScreenshots(response.screenshots ?? recordedScreenshots);
    setNotice(t("notice.recordingScreenshotCaptured"));
  }

  async function summarizeAsSkill() {
    if (!targetTab) return setNotice(t("notice.chooseTarget"));
    if (!messages.length && !events.length && !recordedActions.length) return setNotice(t("notice.nothingToSummarize"));
    setNotice(t("notice.summarizingSkill"));
    const operationNotes = events.flatMap((event) => {
      if (event.type === "action") return [`${t(`browserAction.${event.action}`)}：${event.detail || event.status}`];
      if (event.type === "verify") return [`${t("agent.verify")}：${event.summary}`];
      return [];
    });
    const response = await chrome.runtime.sendMessage({
      type: "ui.skill.summarize",
      input: {
        pageUrl: targetTab.url,
        pageTitle: targetTab.title,
        messages: messagesRef.current,
        actions: recordedActions,
        operationNotes,
      },
    }) as ServerMessage;
    if (response.type !== "skill.summary.result") return setNotice(response.type === "agent.error" ? response.error : t("notice.unexpectedSkillResponse"));
    setEditingSkillSlug("");
    setRecording(false);
    setRecordingStartUrl(response.draft.startUrl);
    setRecordedActions(response.draft.steps);
    setSkillName(response.draft.name);
    setSkillDescription(response.draft.description);
    setSkillInstructions(response.draft.instructions);
    setModal("recording");
    setNotice(t("notice.skillSummaryReady"));
  }

  async function saveSkill() {
    if (recording || (!recordedActions.length && !skillInstructions.trim()) || !skillName.trim()) return setNotice(t("notice.skillDetailsRequired"));
    const draft: AutomationSkillDraft = {
      name: skillName.trim(), description: skillDescription.trim() || t("notice.defaultSkillDescription", { name: skillName.trim() }),
      startUrl: recordingStartUrl || recordedActions[0]?.url || targetTab?.url || "", createdAt: new Date().toISOString(), requiresConfirmation: true, steps: recordedActions,
      instructions: skillInstructions.trim(),
    };
    const response = await chrome.runtime.sendMessage({ type: "ui.skill.save", draft, ...(editingSkillSlug ? { existingSlug: editingSkillSlug } : {}) }) as ServerMessage;
    if (response.type !== "skill.saved") return setNotice(response.type === "agent.error" ? response.error : t("notice.unexpectedSkillResponse"));
    setEditingSkillSlug(response.skill.slug);
    await refreshSkills();
    setNotice(t("notice.skillSaved", { name: response.skill.name, version: response.skill.version }));
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
          onToggle={() => setTargetPickerOpen((current) => !current)}
          onChoose={(tab) => void activateTab(tab.tabId)}
        />
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={busy} onClick={() => void openHistory()} aria-label={t("action.history")} title={t("action.history")}>
            <History size={16} aria-hidden="true" />
          </Button>
          <Button type="button" size="icon" className="h-9 w-9 shrink-0" disabled={busy} onClick={() => void newConversation()} aria-label={t("action.new")} title={t("action.new")}>
            <Plus size={16} aria-hidden="true" />
          </Button>
        </div>
      </header>

      <section ref={threadRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {connection.phase !== "ready"
          ? <ConnectionGate
              title={connection.title}
              message={connection.message}
              checking={connection.phase === "checking"}
              onReconnect={() => void checkConnection(true)}
            />
          : !messages.length && !busy
            ? <EmptyState onPick={() => void startSelection("element")} onSkills={() => setModal("skills")} />
            : null}
        <div className="space-y-5">
          {messages.map((message) => <Message key={message.id} message={message} />)}
          {busy ? <div className="flex items-center gap-2 text-xs text-slate-400"><LoaderCircle className="animate-spin" size={15} />{t("agent.working")}</div> : null}
        </div>

        {selected ? <ContextCard selected={selected.element} screenshot={selected.screenshot} onClose={() => void clearContext()} onAnalyze={() => void analyzeCode()} /> : null}
        {screenshot ? <ScreenshotCard screenshot={screenshot} onClose={() => setScreenshot(null)} /> : null}
        {events.length ? <Timeline events={events} /> : null}
      </section>

      <div className="shrink-0 px-3 pb-3">
        {pendingPlan ? <ApprovalCard plan={pendingPlan} onCancel={() => setPendingPlan(null)} onConfirm={() => void executePlan()} /> : null}
        {pendingChoice ? <ChoiceCard key={`${pendingChoice.question}:${pendingChoice.options?.join("|")}`} choice={pendingChoice} onCancel={cancelChoice} onConfirm={(option) => void submitTask(undefined, option)} /> : null}
        {messages.length || events.length || recordedActions.length ? <div className="mb-1.5 flex justify-end px-1"><button type="button" disabled={busy} onClick={() => void summarizeAsSkill()} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-medium text-slate-500 transition hover:bg-white hover:text-violet-700 disabled:opacity-40"><Sparkles size={12} />{t("action.summarizeSkill")}</button></div> : null}
        <form onSubmit={(event) => void submitTask(event)} className="composer rounded-[22px] border border-slate-200 bg-white p-2.5 shadow-[0_10px_32px_rgba(15,23,42,.09)] transition focus-within:border-slate-300 focus-within:shadow-[0_12px_36px_rgba(15,23,42,.12)]">
          {contextLabel || selectedSkill ? <div className="mb-2 flex flex-wrap gap-1.5">{contextLabel ? <span className="flex max-w-full items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600"><MousePointer2 size={12} /><span className="truncate">{contextLabel}</span><button type="button" onClick={() => void clearContext()} aria-label={t("action.removeContext")}><X size={12} /></button></span> : null}{selectedSkill ? <span className="flex max-w-full items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1 text-[11px] text-violet-700"><Sparkles size={12} /><span className="truncate">{selectedSkill.name}</span><button type="button" onClick={() => { selectedSkillRef.current = null; setSelectedSkill(null); void persistConversation(conversationIdRef.current, messagesRef.current); }} aria-label={t("action.removeSkill")}><X size={12} /></button></span> : null}</div> : null}
          <textarea ref={inputRef} value={prompt} disabled={connection.phase !== "ready"} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitTask(); } }} rows={2} placeholder={connection.phase === "ready" ? t("prompt.ready") : t("prompt.unavailable")} className="composer-input max-h-32 min-h-10 w-full resize-none border-0 bg-transparent px-1 text-[14px] leading-5 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:text-slate-400" />
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-0.5" aria-label={t("prompt.tips")}>
              <ComposerToolButton active={selectionMode === "element"} label={t("action.selectElement")} onClick={() => void startSelection("element")}><MousePointer2 size={15} /></ComposerToolButton>
              <ComposerToolButton active={selectionMode === "image"} label={t("action.selectImageArea")} onClick={() => void startSelection("image")}><Image size={15} /></ComposerToolButton>
              <ComposerToolButton active={Boolean(screenshot)} label={t("action.captureViewport")} onClick={() => void captureScreenshot()}><Camera size={15} /></ComposerToolButton>
              <ComposerToolButton label={t("action.openSkills")} onClick={() => setModal("skills")}><Sparkles size={15} /></ComposerToolButton>
              <ComposerToolButton active={recording} label={recording ? t("action.stopRecording") : t("action.recordWorkflow")} onClick={() => void toggleRecording()}>{recording ? <CircleStop size={15} /> : <Play size={15} />}</ComposerToolButton>
            </div>
            {busy
              ? <button type="button" onClick={() => void stopAgent()} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-950 text-white transition hover:bg-slate-700" aria-label={t("action.stopAgent")} title={t("action.stopAgent")}><CircleStop size={15} /></button>
              : <button type="submit" disabled={!prompt.trim() || connection.phase !== "ready"} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-950 text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-200" aria-label={t("action.send")}><Send size={14} /></button>}
          </div>
        </form>
        <p className="mt-1.5 truncate px-2 text-center text-[10px] text-slate-400">{notice}</p>
      </div>

      {modal === "skills" ? <SkillsModal view={skillView} setView={setSkillView} scope={skillScope} items={activeSkills} selectedSlug={selectedSkill?.slug ?? ""} onClose={() => setModal(null)} onRefresh={() => void refreshSkills()} onAdd={addSkill} onImport={(bundle) => void importSkill(bundle)} onUse={chooseSkill} onInstall={(slug, update) => void installSkill(slug, update)} onToggle={(slug, enabled) => void configureSkill(slug, enabled)} onEdit={(slug) => void editSkill(slug)} onDelete={(slug, name) => void deleteSkill(slug, name)} onExport={(slug) => void exportSkill(slug)} /> : null}
      {modal === "history" ? <HistoryModal logs={historyLogs} currentConversationId={conversationIdRef.current} onClose={() => setModal(null)} onChoose={(log) => void switchHistory(log)} onDelete={(conversationId) => void deleteHistory(conversationId)} /> : null}
      {modal === "recording" ? <RecordingModal active={recording} actions={recordedActions} screenshots={recordedScreenshots} name={skillName} description={skillDescription} instructions={skillInstructions} editing={Boolean(editingSkillSlug)} onName={setSkillName} onDescription={setSkillDescription} onInstructions={setSkillInstructions} onClose={() => setModal(null)} onToggle={() => void toggleRecording()} onCapture={() => void captureRecordingScreenshot()} onReplay={() => void replayRecording()} onSave={() => void saveSkill()} /> : null}
    </main>
  );
}
