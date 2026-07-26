import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Camera, Check, ChevronDown, CircleStop, Code2, Copy, Download, Globe2, History, Image, MessageSquare, MousePointer2, Play, Plus, RefreshCw, Send, Sparkles, Trash2, Upload, WandSparkles, WifiOff, X } from "lucide-react";
import type { AgentEvent, AgentNeedsUser, BrowserActionPlan, BrowserTabTarget, ChatMessage, ConversationLogSummary, InspectedElement, PageSkillSummary, RecordedBrowserAction, RecordedPageScreenshot, SkillCatalogItem, SkillExportBundle } from "@auto-page-agent/shared";
import { defaultChoice } from "./conversation.js";
import { eventLabel, hostname } from "./formatters.js";
import { orderTabsForPicker } from "./tab-picker.js";

export type SkillView = "page" | "installed" | "marketplace";

export function HistoryModal(props: {
  logs: ConversationLogSummary[];
  currentConversationId: string;
  onClose: () => void;
  onChoose: (log: ConversationLogSummary) => void;
  onDelete: (conversationId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ModalShell title={t("history.title")} subtitle={t("history.subtitle")} onClose={props.onClose}>
      <div className="space-y-2">
        {props.logs.length ? props.logs.map((log) => {
          const current = log.conversationId === props.currentConversationId;
          return (
            <article key={log.conversationId} className={`group flex items-center gap-2 rounded-2xl border bg-white p-2 ${current ? "border-violet-300 ring-1 ring-violet-100" : "border-slate-200"}`}>
              <button type="button" onClick={() => props.onChoose(log)} className="flex min-w-0 flex-1 items-start gap-2.5 rounded-xl p-1.5 text-left hover:bg-slate-50">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${current ? "bg-violet-50 text-violet-600" : "bg-slate-100 text-slate-500"}`}>
                  <MessageSquare size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-xs">{log.title}</strong>
                  <span className="mt-1 flex items-center gap-1 truncate text-[9px] text-slate-400">
                    <Globe2 size={10} className="shrink-0" />
                    <span className="truncate">{hostname(log.target.url) || t("history.pageUnavailable")}</span>
                    <span>·</span>
                    <span className="shrink-0">{formatHistoryTime(log.updatedAt)}</span>
                  </span>
                  <span className="mt-1 block text-[9px] text-slate-400">
                    {t("history.counts", { messages: log.messageCount, events: log.eventCount })}
                    {current ? ` · ${t("history.current")}` : ""}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => props.onDelete(log.conversationId)}
                title={t("action.deleteHistory")}
                aria-label={t("action.deleteHistory")}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
              >
                <X size={14} />
              </button>
            </article>
          );
        }) : (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-slate-400">
            <History size={20} />
            <p className="mt-2 text-xs">{t("history.empty")}</p>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function formatHistoryTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ConnectionGate({ title, message, checking, onReconnect }: {
  title: string;
  message: string;
  checking: boolean;
  onReconnect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-[320px] flex-col items-center py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-600">
        {checking ? <RefreshCw size={22} className="animate-spin" /> : <WifiOff size={22} />}
      </span>
      <h2 className="mt-4 text-sm font-semibold">{title}</h2>
      <p className="mt-2 text-xs leading-5 text-slate-500">{message}</p>
      <button
        type="button"
        disabled={checking}
        onClick={onReconnect}
        className="mt-4 flex items-center gap-1.5 rounded-xl bg-slate-950 px-3.5 py-2 text-xs font-medium text-white disabled:bg-slate-300"
      >
        <RefreshCw size={13} className={checking ? "animate-spin" : ""} />
        {checking ? t("action.connecting") : t("action.reconnect")}
      </button>
    </div>
  );
}

export function TargetTabHeader(props: {
  target: BrowserTabTarget | null;
  tabs: BrowserTabTarget[];
  activeTabId: number | null;
  open: boolean;
  onToggle: () => void;
  onChoose: (tab: BrowserTabTarget) => void;
}) {
  const { t } = useTranslation();
  const targetVisible = props.target?.tabId === props.activeTabId;
  const rootRef = useRef<HTMLDivElement>(null);
  const orderedTabs = orderTabsForPicker(props.tabs, props.activeTabId, props.target?.tabId ?? null);

  useEffect(() => {
    if (!props.open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) props.onToggle();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [props.open, props.onToggle]);

  return (
    <div ref={rootRef} className="flex min-w-0 flex-1 items-center gap-2.5">
      <img src="assets/icon-48.png" className="h-9 w-9 shrink-0 rounded-[11px]" alt="" />
      <button type="button" onClick={props.onToggle} className="flex min-w-0 max-w-[calc(100%-46px)] items-center gap-1.5 rounded-xl px-1.5 py-1 text-left transition hover:bg-slate-50" aria-expanded={props.open} aria-label={t("tab.switch")}>
        <span className="min-w-0">
          <strong className="block truncate text-[14px] font-semibold">{props.target?.title ?? t("tab.unavailable")}</strong>
          <span className={`flex items-center gap-1 truncate text-[10px] ${targetVisible ? "text-emerald-600" : "text-orange-500"}`}>
            {props.target?.favIconUrl ? <img src={props.target.favIconUrl} className="h-3 w-3 shrink-0 rounded-[2px]" alt="" /> : <Globe2 size={12} className="shrink-0" />}
            <span className="truncate">
              {props.target
                ? `${hostname(props.target.url)} · ${targetVisible ? t("tab.current") : t("tab.bound")}`
                : t("tab.choose")}
            </span>
          </span>
        </span>
        <ChevronDown size={14} className={`shrink-0 text-slate-400 transition ${props.open ? "rotate-180" : ""}`} />
      </button>
      {props.open ? (
        <div className="absolute left-3 right-3 top-[calc(100%-4px)] z-40 max-h-64 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
          {orderedTabs.length ? orderedTabs.map((tab) => (
            <button key={tab.tabId} type="button" onClick={() => props.onChoose(tab)} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-slate-50">
              {tab.favIconUrl ? <img src={tab.favIconUrl} className="h-4 w-4 shrink-0 rounded-sm" alt="" /> : <Globe2 size={15} className="shrink-0 text-slate-400" />}
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[11px] font-medium">{tab.title}</strong>
                <span className="block truncate text-[9px] text-slate-400">{hostname(tab.url)}{tab.tabId === props.activeTabId ? ` · ${t("tab.current")}` : ""}</span>
              </span>
              {tab.tabId === props.target?.tabId ? <Check size={14} className="shrink-0 text-emerald-600" aria-label={t("tab.conversation")} /> : null}
            </button>
          )) : <p className="px-3 py-5 text-center text-[11px] text-slate-400">{t("tab.noOpenPages")}</p>}
        </div>
      ) : null}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} title={label} aria-label={label} className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">{children}</button>;
}

export function ComposerToolButton({ label, active = false, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} title={label} aria-label={label} aria-pressed={active} className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition ${active ? "bg-slate-200 text-slate-900" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"}`}>{children}</button>;
}

export function EmptyState({ onPick, onSkills }: { onPick: () => void; onSkills: () => void }) {
  const { t } = useTranslation();
  return <div className="mx-auto flex max-w-[310px] flex-col items-center py-12 text-center"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-50 text-violet-600"><WandSparkles size={23} /></span><h2 className="mt-4 text-base font-semibold">{t("prompt.emptyTitle")}</h2><p className="mt-1.5 text-xs leading-5 text-slate-500">{t("prompt.tips")}</p><div className="mt-4 flex gap-2"><button onClick={onPick} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:border-violet-300">{t("action.selectElement")}</button><button onClick={onSkills} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:border-violet-300">{t("action.browseSkills")}</button></div></div>;
}

export function Message({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  const assistant = message.role === "assistant";
  return <article className={`group flex gap-2.5 ${assistant ? "items-start" : "justify-end"}`}>{assistant ? <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-950 text-white"><Bot size={14} /></span> : null}<div className={`${assistant ? "max-w-[calc(100%-38px)] text-slate-700" : "max-w-[86%] rounded-2xl rounded-br-md bg-slate-200/70 px-3.5 py-2.5 text-slate-900"}`}><div className="whitespace-pre-wrap text-[13px] leading-[1.65]">{message.content}</div>{message.attachments?.length ? <div className="mt-2 space-y-1.5">{message.attachments.map((attachment, index) => <div key={`${attachment.kind}-${index}`} className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-300/70 bg-white/70 px-2.5 py-2 text-left">{attachment.kind === "element" ? <MousePointer2 size={13} className="shrink-0 text-violet-600" /> : <Camera size={13} className="shrink-0 text-violet-600" />}<span className="min-w-0 flex-1"><strong className="block truncate text-[10px] font-medium text-slate-700">{attachment.kind === "element" ? `${attachment.captured ? t("attachment.elementCapture") : t("attachment.selectedElement")} · <${attachment.tagName}>` : `${t("attachment.screenshot")} · ${attachment.title}`}</strong><span className="block truncate text-[9px] text-slate-400">{attachment.kind === "element" ? attachment.label : hostname(attachment.pageUrl)} · {t("attachment.usedOnce")}</span></span></div>)}</div> : null}<button type="button" onClick={() => void navigator.clipboard.writeText(message.content)} className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-400 opacity-0 transition group-hover:opacity-100"><Copy size={11} />{t("action.copy")}</button></div></article>;
}

export function ContextCard({ selected, screenshot, onClose, onAnalyze }: {
  selected: InspectedElement;
  screenshot?: { dataUrl: string; title: string; url: string };
  onClose: () => void;
  onAnalyze: () => void;
}) {
  const { t } = useTranslation();
  const preview = screenshot?.dataUrl ?? selected.image?.src;
  return <aside className="mt-5 overflow-hidden rounded-2xl border border-violet-100 bg-violet-50/60">{screenshot ? <div className="relative border-b border-violet-100 bg-white"><img src={screenshot.dataUrl} className="max-h-52 w-full object-contain" alt={screenshot.title} /><span className="absolute bottom-2 left-2 rounded-full bg-slate-950/80 px-2 py-1 text-[9px] font-medium text-white">{t("attachment.elementCapture")}</span></div> : null}<div className="flex items-start gap-3 p-3">{!screenshot && preview ? <img src={preview} className="h-14 w-14 rounded-xl object-cover" alt={selected.image?.alt} /> : !screenshot ? <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-violet-600"><MousePointer2 size={17} /></span> : null}<div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><strong className="truncate text-xs">{screenshot ? t("attachment.captured") : t("attachment.selected")} &lt;{selected.tagName}&gt;</strong><button onClick={onClose} aria-label={t("action.removeSelection")}><X size={14} /></button></div><p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{selected.label || selected.text || selected.nearbyText || t("attachment.noVisibleText")}</p><button onClick={onAnalyze} className="mt-2 flex items-center gap-1 text-[11px] font-medium text-violet-700"><Code2 size={13} />{t("notice.searchingRepositories")}</button></div></div></aside>;
}

export function ScreenshotCard({ screenshot, onClose }: { screenshot: { dataUrl: string; title: string; url: string }; onClose: () => void }) {
  const { t } = useTranslation();
  return <aside className="relative mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white"><img src={screenshot.dataUrl} className="max-h-48 w-full object-cover object-top" alt={screenshot.title} /><button onClick={onClose} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-white/90 shadow" aria-label={t("action.removeScreenshot")}><X size={14} /></button><div className="truncate px-3 py-2 text-[10px] text-slate-500">{screenshot.title} · {t("attachment.localCapture")}</div></aside>;
}

export function Timeline({ events }: { events: AgentEvent[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <aside className="mt-5 rounded-2xl border border-slate-200 bg-white"><button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[11px] font-medium"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-violet-500" />{t("agent.activity", { count: events.length })}</span><ChevronDown size={14} className={open ? "rotate-180" : ""} /></button>{open ? <ol className="max-h-48 space-y-2 overflow-auto border-t border-slate-100 px-3 py-3">{events.map((event) => <li key={event.id} className="flex gap-2 text-[10px] leading-4 text-slate-500"><Check size={12} className="mt-0.5 shrink-0 text-violet-500" /><span>{eventLabel(event, t)}</span></li>)}</ol> : null}</aside>;
}

export function ApprovalCard({ plan, onCancel, onConfirm }: { plan: BrowserActionPlan; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useTranslation();
  return <aside className="mb-2 rounded-2xl border border-violet-200 bg-white p-3 shadow-lg"><div className="flex items-start gap-2"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600"><MousePointer2 size={16} /></span><div className="min-w-0 flex-1"><strong className="text-xs">{t("agent.readyToAct")}</strong><p className="mt-1 text-[11px] leading-4 text-slate-500">{plan.summary}</p>{plan.steps.map((step, index) => <p key={index} className="mt-1.5 rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] text-slate-600">{t(`browserAction.${step.action}`)} · {step.reason}</p>)}</div></div><div className="mt-3 flex justify-end gap-2"><button onClick={onCancel} className="rounded-xl px-3 py-2 text-xs text-slate-500 hover:bg-slate-100">{t("action.cancel")}</button><button onClick={onConfirm} className="flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2 text-xs font-medium text-white hover:bg-violet-600"><Play size={13} />{t("action.runAndVerify")}</button></div></aside>;
}

export function ChoiceCard({ choice, onCancel, onConfirm }: {
  choice: AgentNeedsUser;
  onCancel: () => void;
  onConfirm: (option: string) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(() => defaultChoice(choice));
  return <aside className="mb-2 rounded-2xl border border-violet-200 bg-white p-3 shadow-lg">
    <div className="flex items-start gap-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600"><WandSparkles size={16} /></span>
      <div className="min-w-0 flex-1">
        <strong className="text-xs">{t("agent.choiceRequired")}</strong>
        <p className="mt-1 text-[11px] leading-4 text-slate-600">{choice.question}</p>
        <div className="mt-2 space-y-1.5">
          {choice.options?.map((option) => {
            const checked = selected === option;
            return <label key={option} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2 text-[11px] transition ${checked ? "border-violet-300 bg-violet-50 text-slate-900" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              <input type="radio" name="agent-choice" value={option} checked={checked} onChange={() => setSelected(option)} className="accent-violet-600" />
              <span className="min-w-0 flex-1">{option}</span>
              {choice.recommendedOption === option ? <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-medium text-violet-700">{t("agent.recommended")}</span> : null}
            </label>;
          })}
        </div>
      </div>
    </div>
    <div className="mt-3 flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="rounded-xl px-3 py-2 text-xs text-slate-500 hover:bg-slate-100">{t("action.cancel")}</button>
      <button type="button" disabled={!selected} onClick={() => onConfirm(selected)} className="flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2 text-xs font-medium text-white hover:bg-violet-600 disabled:bg-slate-200">
        <Play size={13} />{t("action.start")}
      </button>
    </div>
  </aside>;
}

export function SkillsModal(props: { view: SkillView; setView: (view: SkillView) => void; scope: string; items: Array<PageSkillSummary | SkillCatalogItem>; selectedSlug: string; onClose: () => void; onRefresh: () => void; onAdd: () => void; onImport: (bundle: SkillExportBundle) => void; onUse: (skill: Pick<SkillCatalogItem, "name" | "description" | "slug">, debug?: boolean) => void; onInstall: (slug: string, update: boolean) => void; onToggle: (slug: string, enabled: boolean) => void; onEdit: (slug: string) => void; onDelete: (slug: string, name: string) => void; onExport: (slug: string) => void }) {
  const { t } = useTranslation();
  const importRef = useRef<HTMLInputElement>(null);
  return <ModalShell title={t("skills.title")} subtitle={t("skills.subtitle")} onClose={props.onClose} action={<><IconButton label={t("action.addSkill")} onClick={props.onAdd}><Plus size={15} /></IconButton><IconButton label={t("action.importSkill")} onClick={() => importRef.current?.click()}><Upload size={15} /></IconButton><IconButton label={t("skills.refresh")} onClick={props.onRefresh}><RefreshCw size={15} /></IconButton><input ref={importRef} type="file" accept=".json,application/json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (!file) return; void file.text().then((text) => { try { props.onImport(JSON.parse(text) as SkillExportBundle); } catch { alert(t("notice.invalidSkillFile")); } }); }} /></>}><div className="grid grid-cols-3 rounded-xl bg-slate-100 p-1">{(["page", "installed", "marketplace"] as const).map((view) => <button key={view} onClick={() => props.setView(view)} className={`rounded-lg px-2 py-2 text-[11px] font-medium ${props.view === view ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{view === "page" ? t("skills.currentPage") : view === "installed" ? t("skills.mine") : t("skills.market")}</button>)}</div><p className="px-1 pt-3 text-[10px] text-slate-400">{props.view === "page" ? props.scope : t("skills.count", { count: props.items.length })}</p><div className="mt-2 space-y-2">{props.items.length ? props.items.map((skill) => <SkillRow key={skill.slug} skill={skill} view={props.view} selected={props.selectedSlug === skill.slug} onUse={props.onUse} onInstall={props.onInstall} onToggle={props.onToggle} onEdit={props.onEdit} onDelete={props.onDelete} onExport={props.onExport} />) : <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-xs text-slate-400">{t("skills.empty")}</p>}</div></ModalShell>;
}

function SkillRow({ skill, view, selected, onUse, onInstall, onToggle, onEdit, onDelete, onExport }: { skill: PageSkillSummary | SkillCatalogItem; view: SkillView; selected: boolean; onUse: (skill: Pick<SkillCatalogItem, "name" | "description" | "slug">, debug?: boolean) => void; onInstall: (slug: string, update: boolean) => void; onToggle: (slug: string, enabled: boolean) => void; onEdit: (slug: string) => void; onDelete: (slug: string, name: string) => void; onExport: (slug: string) => void }) {
  const { t } = useTranslation();
  const pageSkill = "enabled" in skill ? skill : null;
  const catalogSkill = "installed" in skill ? skill : null;
  return <article className={`rounded-2xl border bg-white p-3 ${selected ? "border-violet-300 ring-1 ring-violet-100" : "border-slate-200"} ${pageSkill && !pageSkill.enabled ? "opacity-55" : ""}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><strong className="flex items-center gap-1 truncate text-xs">{selected ? <Check size={12} className="shrink-0 text-violet-600" /> : null}{skill.name}</strong><span className="mt-1 inline-block rounded-full bg-violet-50 px-2 py-0.5 text-[9px] text-violet-600">{t(`skills.scope.${skill.scope}`)}</span></div>{view === "marketplace" && catalogSkill ? <button disabled={catalogSkill.installed && !catalogSkill.updateAvailable} onClick={() => onInstall(skill.slug, catalogSkill.updateAvailable)} className="rounded-lg bg-slate-950 px-2.5 py-1.5 text-[10px] font-medium text-white disabled:bg-slate-100 disabled:text-slate-400">{catalogSkill.updateAvailable ? t("action.update") : catalogSkill.installed ? t("action.installed") : t("action.install")}</button> : <button disabled={Boolean(pageSkill && !pageSkill.enabled)} onClick={() => onUse(skill)} className="rounded-lg bg-slate-950 px-2.5 py-1.5 text-[10px] font-medium text-white disabled:bg-slate-200">{selected ? t("action.selected") : t("action.selectSkill")}</button>}</div><p className="mt-2 text-[11px] leading-4 text-slate-500">{skill.description}</p>{view !== "marketplace" ? <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-400"><button onClick={() => onUse(skill, true)}>{t("action.debug")}</button>{pageSkill?.configurable ? <><button onClick={() => onToggle(skill.slug, !pageSkill.enabled)}>{pageSkill.enabled ? t("action.disable") : t("action.enable")}</button><button onClick={() => onEdit(skill.slug)}>{t("action.edit")}</button></> : catalogSkill?.stepCount ? <button onClick={() => onEdit(skill.slug)}>{t("action.edit")}</button> : null}<button title={t("action.downloadSkill")} aria-label={t("action.downloadSkill")} onClick={() => onExport(skill.slug)}><Download size={12} /></button><button title={t("action.deleteSkill")} aria-label={t("action.deleteSkill")} onClick={() => onDelete(skill.slug, skill.name)} className="text-rose-400"><Trash2 size={12} /></button></div> : null}</article>;
}

export function RecordingModal(props: { active: boolean; actions: RecordedBrowserAction[]; screenshots: RecordedPageScreenshot[]; name: string; description: string; instructions: string; editing: boolean; onName: (value: string) => void; onDescription: (value: string) => void; onInstructions: (value: string) => void; onClose: () => void; onToggle: () => void; onCapture: () => void; onReplay: () => void; onSave: () => void }) {
  const { t } = useTranslation();
  return <ModalShell title={props.active ? t("recording.activeTitle") : props.editing ? t("recording.editTitle") : t("recording.completedTitle")} subtitle={t("recording.capturedContent", { steps: props.actions.length, screenshots: props.screenshots.length })} onClose={props.onClose}><div className="flex gap-2"><button onClick={props.onToggle} className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium ${props.active ? "bg-rose-50 text-rose-700" : "bg-slate-950 text-white"}`}>{props.active ? <CircleStop size={15} /> : <Play size={15} />}{props.active ? t("action.stopRecording") : t("action.startRecording")}</button><button onClick={props.onCapture} disabled={!props.active} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 disabled:opacity-40" title={t("action.recordScreenshot")} aria-label={t("action.recordScreenshot")}><Camera size={15} /></button></div><ol className="mt-3 max-h-40 space-y-1.5 overflow-auto">{props.actions.map((action) => <li key={action.id} className="rounded-lg bg-slate-50 px-2.5 py-2 text-[10px] text-slate-600">{t(`browserAction.${action.action}`)} · {action.label || action.selector || t("recording.page")}</li>)}</ol>{props.screenshots.length ? <div className="mt-3 flex gap-2 overflow-x-auto">{props.screenshots.map((shot) => <img key={shot.id} src={shot.dataUrl} alt={shot.title} title={shot.title} className="h-16 w-24 shrink-0 rounded-lg border border-slate-200 object-cover object-top" />)}</div> : null}<label className="mt-3 block text-[10px] font-medium text-slate-500">{t("recording.skillName")}<input value={props.name} onChange={(event) => props.onName(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-violet-300" /></label><label className="mt-3 block text-[10px] font-medium text-slate-500">{t("recording.description")}<textarea value={props.description} onChange={(event) => props.onDescription(event.target.value)} rows={2} className="mt-1 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-violet-300" /></label><label className="mt-3 block text-[10px] font-medium text-slate-500">{t("recording.instructions")}<textarea value={props.instructions} onChange={(event) => props.onInstructions(event.target.value)} rows={5} className="mt-1 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-xs leading-5 outline-none focus:border-violet-300" /></label><div className="mt-4 flex justify-end gap-2"><button onClick={props.onReplay} disabled={!props.actions.length} className="rounded-xl px-3 py-2 text-xs text-slate-500 disabled:opacity-40">{t("action.testReplay")}</button><button onClick={props.onSave} disabled={(!props.actions.length && !props.instructions.trim()) || props.active} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-medium text-white disabled:bg-slate-200">{props.editing ? t("action.updateSkill") : t("action.saveSkill")}</button></div></ModalShell>;
}

function ModalShell({ title, subtitle, onClose, action, children }: { title: string; subtitle: string; onClose: () => void; action?: ReactNode; children: ReactNode }) {
  const { t } = useTranslation();
  return <div className="fixed inset-0 z-50 flex items-end bg-slate-950/20 p-2 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="max-h-[86vh] w-full overflow-y-auto rounded-[24px] border border-slate-200 bg-[#f8f9fb] p-4 shadow-2xl"><header className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold">{title}</h2><p className="text-[10px] text-slate-400">{subtitle}</p></div><div className="flex items-center gap-1">{action}<IconButton label={t("action.close")} onClick={onClose}><X size={17} /></IconButton></div></header>{children}</section></div>;
}
