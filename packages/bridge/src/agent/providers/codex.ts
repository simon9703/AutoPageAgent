import type { AgentDecision, CodexRuntimeStatus, PageSnapshot } from "@auto-page-agent/shared";
import { CodexAppServerClient } from "../../codex-app-server.js";
import { loadSkills, selectSkillContext } from "../../skills.js";
import { extractJson, mockDecision, normalizeDecision } from "../decision.js";
import { createAgentPrompt } from "../prompt.js";
import type { AgentEventSink, AgentRunContext } from "../types.js";

export class CodexProvider {
  readonly name = "Local Codex";
  #client = new CodexAppServerClient();
  #threads = new Map<string, string>();
  #statusCache?: { expiresAt: number; value: CodexRuntimeStatus };
  #statusRequest?: Promise<CodexRuntimeStatus>;

  reset(conversationId: string): void { this.#threads.delete(conversationId); }

  async status(): Promise<CodexRuntimeStatus> {
    if (process.env.AUTO_PAGE_AGENT_MOCK === "1") return { available: true, authenticated: true, authMode: "chatgpt", command: "mock" };
    if (this.#statusCache && this.#statusCache.expiresAt > Date.now()) return this.#statusCache.value;
    if (this.#statusRequest) return this.#statusRequest;
    this.#statusRequest = this.#readStatus();
    try {
      const value = await this.#statusRequest;
      this.#statusCache = { expiresAt: Date.now() + 15_000, value };
      return value;
    } finally {
      this.#statusRequest = undefined;
    }
  }

  async #readStatus(): Promise<CodexRuntimeStatus> {
    const runtime = await this.#client.inspectRuntime();
    if (!runtime.available) return { available: false, authenticated: false, authMode: null, error: runtime.configuredCommandInvalid ? "Invalid CODEX_PATH." : "Codex CLI not found." };
    try {
      const account = await this.#client.request<{ requiresOpenaiAuth?: boolean; account?: { type?: string } }>("account/read", { refreshToken: false });
      const authMode = account.account?.type === "chatgpt" ? "chatgpt" : account.account?.type === "apiKey" ? "apikey" : null;
      if (authMode === "apikey") {
        return { available: true, command: runtime.command, authenticated: false, authMode, error: "Main browser-agent requests do not use Codex API-key sessions yet. Sign in with ChatGPT/Codex OAuth." };
      }
      const authenticated = Boolean(account.account) || account.requiresOpenaiAuth === false;
      return { available: true, command: runtime.command, authenticated, authMode, ...(!authenticated ? { error: "Codex is not signed in. Run codex login." } : {}) };
    } catch (error) {
      return { available: true, command: runtime.command, authenticated: false, authMode: null, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async run(task: string, snapshot: PageSnapshot, context: AgentRunContext, _onEvent?: AgentEventSink): Promise<AgentDecision> {
    if (process.env.AUTO_PAGE_AGENT_MOCK === "1") return mockDecision(task, snapshot);
    const status = await this.status();
    if (!status.available || !status.authenticated) throw new Error(status.error || "Local Codex is unavailable.");
    const skills = context.selectedSkills ?? selectSkillContext(task, await loadSkills(), snapshot.url);
    let threadId = this.#threads.get(context.conversationId);
    const isNewThread = !threadId;
    if (!threadId) {
      const thread = await this.#client.request<{ thread?: { id?: string } }>("thread/start", {
        approvalPolicy: "never",
        personality: "pragmatic",
        ephemeral: true,
        persistExtendedHistory: false,
      });
      threadId = thread.thread?.id;
      if (!threadId) throw new Error("Codex did not return a thread id.");
      this.#threads.set(context.conversationId, threadId);
    }
    const prompt = createAgentPrompt(task, snapshot, skills.map((skill) => skill.body), isNewThread ? context.history : [], context.loop, skills);
    return this.#runTurn(threadId, prompt, snapshot, task, context.signal);
  }

  async #runTurn(threadId: string, prompt: string, snapshot: PageSnapshot, task: string, signal?: AbortSignal): Promise<AgentDecision> {
    if (signal?.aborted) throw new Error("Agent run stopped.");
    let turnId = "";
    let text = "";
    let unsubscribe: () => void = () => undefined;
    const completed = new Promise<void>((resolve, reject) => {
      unsubscribe = this.#client.onNotification((notification) => {
        const params = notification.params ?? {};
        if (String(params.threadId ?? "") !== threadId) return;
        if (turnId && params.turnId && String(params.turnId) !== turnId) return;
        if (notification.method === "item/completed") {
          const item = params.item as { type?: string; text?: string; content?: unknown } | undefined;
          if (item?.type === "agentMessage") text = extractAgentMessageText(item) || text;
        }
        if (notification.method === "item/agentMessage/delta" || notification.method === "item/outputText/delta") {
          const delta = typeof params.delta === "string" ? params.delta : "";
          if (delta) text += delta;
        }
        if (notification.method === "error") { unsubscribe(); reject(new Error(readErrorMessage(params.error) || "Codex app-server reported an error.")); }
        if (notification.method === "turn/completed") {
          const turn = params.turn as { error?: unknown; items?: unknown[] } | undefined;
          const turnError = readErrorMessage(turn?.error);
          if (!text && Array.isArray(turn?.items)) {
            for (const item of turn.items) text = extractAgentMessageText(item) || text;
          }
          unsubscribe();
          if (turnError) reject(new Error(turnError)); else resolve();
        }
        if (notification.method === "turn/failed") { unsubscribe(); reject(new Error(readErrorMessage(params.error) || "Codex turn failed.")); }
      });
    });
    try {
      const turn = await this.#client.request<{ turn?: { id?: string } }>("turn/start", {
        threadId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
        effort: "low",
        approvalPolicy: "never",
      });
      turnId = turn.turn?.id ?? "";
      const interrupt = () => {
        if (turnId) void this.#client.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
      };
      signal?.addEventListener("abort", interrupt, { once: true });
      try {
        await withTimeout(completed, 40_000, signal);
      } finally {
        signal?.removeEventListener("abort", interrupt);
      }
      return normalizeDecision(extractJson(text), snapshot, task);
    } finally {
      unsubscribe();
    }
  }
}

function extractAgentMessageText(value: unknown): string {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (item.type !== "agentMessage") return "";
  if (typeof item.text === "string") return item.text.trim();
  if (!Array.isArray(item.content)) return "";
  return item.content.flatMap((part) => {
    if (typeof part === "string") return [part];
    if (!part || typeof part !== "object") return [];
    const record = part as Record<string, unknown>;
    return typeof record.text === "string" ? [record.text] : [];
  }).join("").trim();
}

function readErrorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return typeof record.message === "string" ? record.message : typeof record.error === "string" ? record.error : "";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Codex turn timed out.")), timeoutMs); }),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("Agent run stopped."));
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
