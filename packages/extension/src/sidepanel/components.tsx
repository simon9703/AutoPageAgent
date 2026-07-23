import { useState } from "react";
import type { ReactNode } from "react";
import { Bot, Camera, Check, ChevronDown, CircleStop, Code2, Copy, Globe2, Image, MousePointer2, Play, RefreshCw, Send, Sparkles, WandSparkles, X } from "lucide-react";
import type { AgentEvent, BrowserActionPlan, BrowserTabTarget, ChatMessage, InspectedElement, PageSkillSummary, RecordedBrowserAction, SkillCatalogItem } from "@auto-page-agent/shared";
import { eventLabel, hostname } from "./formatters.js";

export type SkillView = "page" | "installed" | "marketplace";

export function TargetTabHeader(props: {
  target: BrowserTabTarget | null;
  tabs: BrowserTabTarget[];
  activeTabId: number | null;
  open: boolean;
  queued: BrowserTabTarget | null;
  onToggle: () => void;
  onChoose: (tab: BrowserTabTarget) => void;
}) {
  const targetVisible = props.target?.tabId === props.activeTabId;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <img src="assets/icon-48.png" className="h-9 w-9 shrink-0 rounded-[11px]" alt="" />
      <button type="button" onClick={props.onToggle} className="flex min-w-0 max-w-[calc(100%-46px)] items-center gap-1.5 rounded-xl px-1.5 py-1 text-left transition hover:bg-slate-50" aria-expanded={props.open}>
        <span className="min-w-0">
          <strong className="block truncate text-[14px] font-semibold">{props.queued ? props.queued.title : props.target?.title ?? "Select a page"}</strong>
          <span className={`flex items-center gap-1 truncate text-[10px] ${targetVisible ? "text-slate-400" : "text-violet-600"}`}>
            {props.target?.favIconUrl ? <img src={props.target.favIconUrl} className="h-3 w-3 shrink-0 rounded-[2px]" alt="" /> : <Globe2 size={12} className="shrink-0" />}
            <span className="truncate">
              {props.queued
                ? `Next target · ${hostname(props.queued.url)}`
                : props.target
                  ? `${hostname(props.target.url)}${targetVisible ? " · current page" : " · conversation target"}`
                  : "Open an http(s) page"}
            </span>
          </span>
        </span>
        <ChevronDown size={14} className={`shrink-0 text-slate-400 transition ${props.open ? "rotate-180" : ""}`} />
      </button>
      {props.open ? (
        <div className="absolute left-3 right-3 top-[calc(100%-4px)] z-40 max-h-64 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
          {props.tabs.length ? props.tabs.map((tab) => (
            <button key={tab.tabId} type="button" onClick={() => props.onChoose(tab)} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-slate-50">
              {tab.favIconUrl ? <img src={tab.favIconUrl} className="h-4 w-4 shrink-0 rounded-sm" alt="" /> : <Globe2 size={15} className="shrink-0 text-slate-400" />}
              <span className="min-w-0 flex-1"><strong className="block truncate text-[11px] font-medium">{tab.title}</strong><span className="block truncate text-[9px] text-slate-400">{hostname(tab.url)}{tab.tabId === props.activeTabId ? " · viewing" : ""}</span></span>
              {tab.tabId === props.target?.tabId ? <Check size={14} className="shrink-0 text-violet-600" /> : null}
            </button>
          )) : <p className="px-3 py-5 text-center text-[11px] text-slate-400">No open http(s) pages.</p>}
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
  return <div className="mx-auto flex max-w-[310px] flex-col items-center py-12 text-center"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-50 text-violet-600"><WandSparkles size={23} /></span><h2 className="mt-4 text-base font-semibold">What should we do here?</h2><p className="mt-1.5 text-xs leading-5 text-slate-500">Ask about the current page, select an element for context, or run a reusable Skill.</p><div className="mt-4 flex gap-2"><button onClick={onPick} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:border-violet-300">Select element</button><button onClick={onSkills} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:border-violet-300">Browse Skills</button></div></div>;
}

export function Message({ message }: { message: ChatMessage }) {
  const assistant = message.role === "assistant";
  return <article className={`group flex gap-2.5 ${assistant ? "items-start" : "justify-end"}`}>{assistant ? <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-950 text-white"><Bot size={14} /></span> : null}<div className={`${assistant ? "max-w-[calc(100%-38px)] text-slate-700" : "max-w-[86%] rounded-2xl rounded-br-md bg-slate-200/70 px-3.5 py-2.5 text-slate-900"}`}><div className="whitespace-pre-wrap text-[13px] leading-[1.65]">{message.content}</div><button type="button" onClick={() => void navigator.clipboard.writeText(message.content)} className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-400 opacity-0 transition group-hover:opacity-100"><Copy size={11} />Copy</button></div></article>;
}

export function ContextCard({ selected, screenshot, onClose, onAnalyze }: {
  selected: InspectedElement;
  screenshot?: { dataUrl: string; title: string; url: string };
  onClose: () => void;
  onAnalyze: () => void;
}) {
  const preview = screenshot?.dataUrl ?? selected.image?.src;
  return <aside className="mt-5 overflow-hidden rounded-2xl border border-violet-100 bg-violet-50/60">{screenshot ? <div className="relative border-b border-violet-100 bg-white"><img src={screenshot.dataUrl} className="max-h-52 w-full object-contain" alt={screenshot.title} /><span className="absolute bottom-2 left-2 rounded-full bg-slate-950/80 px-2 py-1 text-[9px] font-medium text-white">Element capture</span></div> : null}<div className="flex items-start gap-3 p-3">{!screenshot && preview ? <img src={preview} className="h-14 w-14 rounded-xl object-cover" alt={selected.image?.alt} /> : !screenshot ? <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-violet-600"><MousePointer2 size={17} /></span> : null}<div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><strong className="truncate text-xs">{screenshot ? "Captured" : "Selected"} &lt;{selected.tagName}&gt;</strong><button onClick={onClose} aria-label="Remove selection"><X size={14} /></button></div><p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{selected.label || selected.text || selected.nearbyText || "No visible text"}</p><button onClick={onAnalyze} className="mt-2 flex items-center gap-1 text-[11px] font-medium text-violet-700"><Code2 size={13} />Find in repositories</button></div></div></aside>;
}

export function ScreenshotCard({ screenshot, onClose }: { screenshot: { dataUrl: string; title: string; url: string }; onClose: () => void }) {
  return <aside className="relative mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white"><img src={screenshot.dataUrl} className="max-h-48 w-full object-cover object-top" alt={screenshot.title} /><button onClick={onClose} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-white/90 shadow" aria-label="Remove screenshot"><X size={14} /></button><div className="truncate px-3 py-2 text-[10px] text-slate-500">{screenshot.title} · local capture</div></aside>;
}

export function Timeline({ events }: { events: AgentEvent[] }) {
  const [open, setOpen] = useState(false);
  return <aside className="mt-5 rounded-2xl border border-slate-200 bg-white"><button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[11px] font-medium"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-violet-500" />Agent activity · {events.length}</span><ChevronDown size={14} className={open ? "rotate-180" : ""} /></button>{open ? <ol className="max-h-48 space-y-2 overflow-auto border-t border-slate-100 px-3 py-3">{events.map((event) => <li key={event.id} className="flex gap-2 text-[10px] leading-4 text-slate-500"><Check size={12} className="mt-0.5 shrink-0 text-violet-500" /><span>{eventLabel(event)}</span></li>)}</ol> : null}</aside>;
}

export function ApprovalCard({ plan, onCancel, onConfirm }: { plan: BrowserActionPlan; onCancel: () => void; onConfirm: () => void }) {
  return <aside className="mb-2 rounded-2xl border border-violet-200 bg-white p-3 shadow-lg"><div className="flex items-start gap-2"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600"><MousePointer2 size={16} /></span><div className="min-w-0 flex-1"><strong className="text-xs">Ready to act on this page</strong><p className="mt-1 text-[11px] leading-4 text-slate-500">{plan.summary}</p>{plan.steps.map((step, index) => <p key={index} className="mt-1.5 rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] text-slate-600">{step.action} · {step.reason}</p>)}</div></div><div className="mt-3 flex justify-end gap-2"><button onClick={onCancel} className="rounded-xl px-3 py-2 text-xs text-slate-500 hover:bg-slate-100">Cancel</button><button onClick={onConfirm} className="flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2 text-xs font-medium text-white hover:bg-violet-600"><Play size={13} />Run & verify</button></div></aside>;
}

export function SkillsModal(props: { view: SkillView; setView: (view: SkillView) => void; scope: string; items: Array<PageSkillSummary | SkillCatalogItem>; onClose: () => void; onRefresh: () => void; onUse: (skill: Pick<SkillCatalogItem, "name" | "description">, debug?: boolean) => void; onInstall: (slug: string, update: boolean) => void; onToggle: (slug: string, enabled: boolean) => void; onEdit: (slug: string) => void }) {
  return <ModalShell title="Skills" subtitle="Reusable page actions" onClose={props.onClose} action={<IconButton label="Refresh Skills" onClick={props.onRefresh}><RefreshCw size={15} /></IconButton>}><div className="grid grid-cols-3 rounded-xl bg-slate-100 p-1">{(["page", "installed", "marketplace"] as const).map((view) => <button key={view} onClick={() => props.setView(view)} className={`rounded-lg px-2 py-2 text-[11px] font-medium capitalize ${props.view === view ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{view === "page" ? "This page" : view === "installed" ? "My Skills" : "Explore"}</button>)}</div><p className="px-1 pt-3 text-[10px] text-slate-400">{props.view === "page" ? props.scope : `${props.items.length} Skills`}</p><div className="mt-2 space-y-2">{props.items.length ? props.items.map((skill) => <SkillRow key={skill.slug} skill={skill} view={props.view} onUse={props.onUse} onInstall={props.onInstall} onToggle={props.onToggle} onEdit={props.onEdit} />) : <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-xs text-slate-400">No Skills here yet.</p>}</div></ModalShell>;
}

function SkillRow({ skill, view, onUse, onInstall, onToggle, onEdit }: { skill: PageSkillSummary | SkillCatalogItem; view: SkillView; onUse: (skill: Pick<SkillCatalogItem, "name" | "description">, debug?: boolean) => void; onInstall: (slug: string, update: boolean) => void; onToggle: (slug: string, enabled: boolean) => void; onEdit: (slug: string) => void }) {
  const pageSkill = "enabled" in skill ? skill : null;
  const catalogSkill = "installed" in skill ? skill : null;
  return <article className={`rounded-2xl border border-slate-200 bg-white p-3 ${pageSkill && !pageSkill.enabled ? "opacity-55" : ""}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><strong className="block truncate text-xs">{skill.name}</strong><span className="mt-1 inline-block rounded-full bg-violet-50 px-2 py-0.5 text-[9px] text-violet-600">{skill.scope}</span></div>{view === "marketplace" && catalogSkill ? <button disabled={catalogSkill.installed && !catalogSkill.updateAvailable} onClick={() => onInstall(skill.slug, catalogSkill.updateAvailable)} className="rounded-lg bg-slate-950 px-2.5 py-1.5 text-[10px] font-medium text-white disabled:bg-slate-100 disabled:text-slate-400">{catalogSkill.updateAvailable ? "Update" : catalogSkill.installed ? "Installed" : "Install"}</button> : <button disabled={Boolean(pageSkill && !pageSkill.enabled)} onClick={() => onUse(skill)} className="rounded-lg bg-slate-950 px-2.5 py-1.5 text-[10px] font-medium text-white disabled:bg-slate-200">Use</button>}</div><p className="mt-2 text-[11px] leading-4 text-slate-500">{skill.description}</p>{view !== "marketplace" ? <div className="mt-2 flex gap-3 text-[10px] text-slate-400"><button onClick={() => onUse(skill, true)}>Debug</button>{pageSkill?.configurable ? <><button onClick={() => onToggle(skill.slug, !pageSkill.enabled)}>{pageSkill.enabled ? "Disable" : "Enable"}</button><button onClick={() => onEdit(skill.slug)}>Edit</button></> : catalogSkill?.stepCount ? <button onClick={() => onEdit(skill.slug)}>Edit</button> : null}</div> : null}</article>;
}

export function RecordingModal(props: { active: boolean; actions: RecordedBrowserAction[]; name: string; description: string; editing: boolean; onName: (value: string) => void; onDescription: (value: string) => void; onClose: () => void; onToggle: () => void; onReplay: () => void; onSave: () => void }) {
  return <ModalShell title={props.active ? "Recording workflow" : props.editing ? "Edit Skill" : "Recorded workflow"} subtitle={`${props.actions.length} captured steps`} onClose={props.onClose}><button onClick={props.onToggle} className={`flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium ${props.active ? "bg-rose-50 text-rose-700" : "bg-slate-950 text-white"}`}>{props.active ? <CircleStop size={15} /> : <Play size={15} />}{props.active ? "Stop recording" : "Start recording"}</button><ol className="mt-3 max-h-40 space-y-1.5 overflow-auto">{props.actions.map((action) => <li key={action.id} className="rounded-lg bg-slate-50 px-2.5 py-2 text-[10px] text-slate-600">{action.action} · {action.label || action.selector || "page"}</li>)}</ol><label className="mt-3 block text-[10px] font-medium text-slate-500">Skill name<input value={props.name} onChange={(event) => props.onName(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-violet-300" /></label><label className="mt-3 block text-[10px] font-medium text-slate-500">Description<textarea value={props.description} onChange={(event) => props.onDescription(event.target.value)} rows={2} className="mt-1 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-violet-300" /></label><div className="mt-4 flex justify-end gap-2"><button onClick={props.onReplay} disabled={!props.actions.length} className="rounded-xl px-3 py-2 text-xs text-slate-500 disabled:opacity-40">Test replay</button><button onClick={props.onSave} disabled={!props.actions.length || props.active} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-medium text-white disabled:bg-slate-200">{props.editing ? "Update Skill" : "Save Skill"}</button></div></ModalShell>;
}

function ModalShell({ title, subtitle, onClose, action, children }: { title: string; subtitle: string; onClose: () => void; action?: ReactNode; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-end bg-slate-950/20 p-2 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="max-h-[86vh] w-full overflow-y-auto rounded-[24px] border border-slate-200 bg-[#f8f9fb] p-4 shadow-2xl"><header className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold">{title}</h2><p className="text-[10px] text-slate-400">{subtitle}</p></div><div className="flex items-center gap-1">{action}<IconButton label="Close" onClick={onClose}><X size={17} /></IconButton></div></header>{children}</section></div>;
}
