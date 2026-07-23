import type { AgentDecision, AgentEvent, AgentLoopContext, AgentRuntimeStatus, BrowserActionPlan, ChatMessage, CodexRuntimeStatus, PageSnapshot, SkillSelection } from "@auto-page-agent/shared";
import { CodexAppServerClient } from "./codex-app-server.js";
import { loadSkills, selectSkillContext } from "./skills.js";

const ACTIONS = new Set(["click", "fill", "select", "scroll", "focus", "submit"]);

export interface AgentRunContext {
  conversationId: string;
  history: ChatMessage[];
  loop?: AgentLoopContext;
  signal?: AbortSignal;
  selectedSkills?: SkillSelection[];
}

export type AgentEventSink = (event: AgentEvent) => void;
type EventWithoutMeta<T> = T extends unknown ? Omit<T, "id" | "timestamp"> : never;
type AgentEventInput = EventWithoutMeta<AgentEvent>;

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
    return this.#runTurn(threadId, prompt, snapshot, context.signal);
  }

  async #runTurn(threadId: string, prompt: string, snapshot: PageSnapshot, signal?: AbortSignal): Promise<AgentDecision> {
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
      return normalizeDecision(extractJson(text), snapshot);
    } finally {
      unsubscribe();
    }
  }
}

export class OpenAIResponsesProvider {
  readonly name = "OpenAI Responses API";
  readonly model: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #previousResponses = new Map<string, string>();

  reset(conversationId: string): void { this.#previousResponses.delete(conversationId); }

  constructor(options: { apiKey?: string; model?: string; fetchImpl?: typeof fetch } = {}) {
    this.#apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-5.6-sol";
    this.#fetch = options.fetchImpl ?? fetch;
  }

  status(): AgentRuntimeStatus {
    return {
      id: "openai",
      name: this.name,
      model: this.model,
      available: Boolean(this.#apiKey),
      authenticated: Boolean(this.#apiKey),
      ...(!this.#apiKey ? { error: "Set OPENAI_API_KEY in the local bridge environment." } : {}),
    };
  }

  async run(task: string, snapshot: PageSnapshot, context: AgentRunContext, _onEvent?: AgentEventSink): Promise<AgentDecision> {
    if (!this.#apiKey) throw new Error("OPENAI_API_KEY is not configured in the local bridge.");
    if (process.env.AUTO_PAGE_AGENT_MOCK === "1") return mockDecision(task, snapshot);
    const skills = context.selectedSkills ?? selectSkillContext(task, await loadSkills(), snapshot.url);
    const previousResponseId = this.#previousResponses.get(context.conversationId);
    const prompt = createAgentPrompt(task, snapshot, skills.map((skill) => skill.body), previousResponseId ? [] : context.history, context.loop, skills);
    const userContent: Array<Record<string, unknown>> = [{ type: "input_text", text: prompt }];
    const imageUrl = snapshot.context?.screenshot?.dataUrl
      ?? snapshot.context?.selectedElement?.image?.src;
    if (imageUrl && /^(?:https?:|data:image\/)/iu.test(imageUrl)) userContent.push({ type: "input_image", image_url: imageUrl, detail: "auto" });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("timeout"), 60_000);
    const cancel = () => controller.abort("cancelled");
    context.signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await this.#fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.#apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          input: [{ role: "user", content: userContent }],
          ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
          store: true,
          reasoning: { effort: "low" },
          stream: true,
          text: { format: { type: "json_schema", name: "browser_decision", strict: false, schema: responsesDecisionSchema } },
        }),
      });
      if (!response.ok) {
        const payload = await response.json() as Record<string, unknown>;
        throw new Error(readResponsesError(payload) || `OpenAI Responses API failed with HTTP ${response.status}.`);
      }
      const streamed = await readResponsesStream(response);
      if (streamed.responseId) this.#previousResponses.set(context.conversationId, streamed.responseId);
      return normalizeDecision(extractJson(streamed.text), snapshot);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (context.signal?.aborted) throw new Error("Agent run stopped.");
        throw new Error("OpenAI Responses API timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      context.signal?.removeEventListener("abort", cancel);
    }
  }
}

export class AgentRouter {
  readonly codex = new CodexProvider();
  readonly openai: OpenAIResponsesProvider;

  constructor(openai = new OpenAIResponsesProvider()) { this.openai = openai; }

  reset(conversationId: string): void {
    this.codex.reset(conversationId);
    this.openai.reset(conversationId);
  }

  async status(codexStatus?: CodexRuntimeStatus): Promise<AgentRuntimeStatus> {
    const preference = normalizeProviderPreference(process.env.AUTO_PAGE_AGENT_PROVIDER);
    const local = codexStatus ?? await this.codex.status();
    const api = this.openai.status();
    if (preference === "openai") return api;
    if (preference === "codex") return toCodexAgentStatus(local);
    return local.available && local.authenticated ? toCodexAgentStatus(local) : api.available ? api : toCodexAgentStatus(local);
  }

  async run(task: string, snapshot: PageSnapshot, context: AgentRunContext, onEvent?: AgentEventSink): Promise<{ decision: AgentDecision; provider: string; selectedSkills: Omit<SkillSelection, "body">[] }> {
    const status = await this.status();
    if (!status.available || !status.authenticated) throw new Error(status.error || "No agent provider is available.");
    const selectedSkills = selectSkillContext(task, await loadSkills(), snapshot.url);
    const providerContext = { ...context, selectedSkills };
    const decision = status.id === "openai"
      ? await this.openai.run(task, snapshot, providerContext, onEvent)
      : await this.codex.run(task, snapshot, providerContext, onEvent);
    if (decision.kind === "complete") emit(onEvent, { type: "complete", summary: decision.summary.slice(0, 240) });
    return { decision, provider: status.name, selectedSkills: selectedSkills.map(({ body: _body, ...skill }) => skill) };
  }
}

function emit(sink: AgentEventSink | undefined, event: AgentEventInput): void {
  sink?.({ ...event, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, timestamp: new Date().toISOString() } as AgentEvent);
}

function normalizeProviderPreference(value: string | undefined): "auto" | "codex" | "openai" {
  return value === "codex" || value === "openai" ? value : "auto";
}

function toCodexAgentStatus(status: CodexRuntimeStatus): AgentRuntimeStatus {
  return { id: "codex", name: "Local Codex", available: status.available, authenticated: status.authenticated, error: status.error };
}

export const responsesDecisionSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["answer", "action_plan", "complete", "blocked", "needs_user"] },
    content: { type: "string" },
    summary: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    reason: { type: "string" },
    recoverable: { type: "boolean" },
    question: { type: "string" },
    snapshotId: { type: "string" },
    requiresConfirmation: { type: "boolean" },
    confidence: { type: "number" },
    steps: { type: "array", items: { type: "object", additionalProperties: true } },
  },
  required: ["kind"],
  additionalProperties: true,
} as const;

export function extractResponsesText(value: unknown): string {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (typeof record.output_text === "string") return record.output_text;
  if (!Array.isArray(record.output)) return "";
  return record.output.flatMap((item) => {
    const output = item && typeof item === "object" ? item as Record<string, unknown> : {};
    if (!Array.isArray(output.content)) return [];
    return output.content.flatMap((part) => {
      const content = part && typeof part === "object" ? part as Record<string, unknown> : {};
      return typeof content.text === "string" ? [content.text] : [];
    });
  }).join("\n").trim();
}

export async function readResponsesStream(response: Response): Promise<{ text: string; responseId?: string }> {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const payload = await response.json() as Record<string, unknown>;
    return { text: extractResponsesText(payload), ...(typeof payload.id === "string" ? { responseId: payload.id } : {}) };
  }
  if (!response.body) throw new Error("OpenAI Responses API returned no stream body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let responseId: string | undefined;
  const consume = (frame: string) => {
    const data = frame.split(/\r?\n/u).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
    let event: Record<string, unknown>;
    try { event = JSON.parse(data) as Record<string, unknown>; } catch { return; }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      text += event.delta;
    }
    const completed = event.response && typeof event.response === "object" ? event.response as Record<string, unknown> : undefined;
    if (completed) {
      if (typeof completed.id === "string") responseId = completed.id;
      if (!text) text = extractResponsesText(completed);
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/u);
    buffer = frames.pop() ?? "";
    frames.forEach(consume);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  return { text, ...(responseId ? { responseId } : {}) };
}

function readResponsesError(value: Record<string, unknown>): string {
  const error = value.error && typeof value.error === "object" ? value.error as Record<string, unknown> : {};
  return typeof error.message === "string" ? error.message : "";
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

export function createAgentPrompt(task: string, snapshot: PageSnapshot, skills: string[], history: ChatMessage[] = [], loop?: AgentLoopContext, selectedSkills: SkillSelection[] = []): string {
  const loopState = loop ? { iteration: loop.iteration, maxSteps: loop.maxSteps, elapsedMs: Date.now() - loop.startedAt, lastAction: loop.lastAction, lastVerification: loop.lastVerification } : undefined;
  const promptSnapshot = {
    ...snapshot,
    elements: undefined,
    ...(snapshot.context?.screenshot ? { context: { ...snapshot.context, screenshot: { title: snapshot.context.screenshot.title, url: snapshot.context.screenshot.url } } } : {}),
  };
  return [
    "You are a current-page browser agent. Internally observe, decide, act, and verify without narrating those phase names.",
    "Return exactly one JSON object without Markdown.",
    "For a request that needs no browser action return: {\"kind\":\"answer\",\"content\":\"...\"}.",
    "For an explicit browser action return: {\"kind\":\"action_plan\",\"summary\":\"...\",\"snapshotId\":\"...\",\"requiresConfirmation\":true,\"confidence\":0.8,\"steps\":[{\"action\":\"click|fill|select|scroll|focus|submit\",\"targetRef\":\"element-ref\",\"value\":\"...\",\"reason\":\"...\"}]}.",
    "When the entire original browser task is satisfied return: {\"kind\":\"complete\",\"summary\":\"...\",\"evidence\":[\"exact text or URL copied from the current snapshot\"]}.",
    "When required user input or confirmation is missing return: {\"kind\":\"needs_user\",\"question\":\"...\"}.",
    "When no safe action or recovery is available return: {\"kind\":\"blocked\",\"reason\":\"...\",\"recoverable\":false}.",
    "Plan exactly one next action. The runtime observes and verifies the page again before asking for another action.",
    "Use only data-ai-ref values present in simplifiedDom as targetRef. Prefer visible, unoccluded, enabled elements. Never output JavaScript, CSS selectors, XPath, payment, purchase, credential, destructive, or final irreversible actions.",
    "A successful action is not task completion. Once an action has been executed, never use answer to report completion; use complete with exact evidence copied from the current snapshot. Navigation alone is not completion.",
    selectedSkills.length ? `Selected Skill context:\n${selectedSkills.map((skill) => `${skill.name} (${skill.scope}): ${skill.reason}`).join("\n")}` : "",
    skills.length ? `Applicable skills:\n${skills.join("\n\n")}` : "",
    history.length ? `Recent conversation:\n${history.slice(-12).map((message) => `${message.role}: ${message.content}`).join("\n")}` : "",
    loopState ? `Loop state:\n${JSON.stringify(loopState)}` : "",
    `User task:\n${task}`,
    `Page snapshot:\n${JSON.stringify(promptSnapshot)}`,
  ].filter(Boolean).join("\n\n");
}

export function normalizeDecision(value: unknown, snapshot: PageSnapshot): AgentDecision {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (raw.kind === "answer") {
    return { kind: "answer", content: String(raw.content || "The agent returned no answer.").slice(0, 8_000) };
  }
  if (raw.kind === "complete") {
    const evidence = Array.isArray(raw.evidence)
      ? raw.evidence.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.slice(0, 500)).slice(0, 8)
      : [];
    if (!evidence.length) {
      return { kind: "blocked", reason: "The agent claimed completion without current page evidence.", recoverable: true };
    }
    if (!evidence.every((item) => completionEvidenceMatchesSnapshot(item, snapshot))) {
      return { kind: "blocked", reason: "The agent claimed completion with evidence that is not present in the current page snapshot.", recoverable: true };
    }
    return { kind: "complete", summary: String(raw.summary || "Task completed.").slice(0, 2_000), evidence };
  }
  if (raw.kind === "needs_user") {
    return { kind: "needs_user", question: String(raw.question || "More information is required.").slice(0, 2_000) };
  }
  if (raw.kind === "blocked") {
    return {
      kind: "blocked",
      reason: String(raw.reason || "The agent could not continue safely.").slice(0, 2_000),
      recoverable: raw.recoverable === true,
    };
  }
  if (raw.kind !== "action_plan") {
    return { kind: "blocked", reason: "The agent returned an unsupported decision.", recoverable: true };
  }
  const validRefs = new Set(snapshot.elements.filter((element) => !element.occluded).map((element) => element.ref));
  const writableRefs = new Set(snapshot.elements.filter((element) => !element.disabled && !element.readonly && !element.sensitive && !element.occluded).map((element) => element.ref));
  const steps = Array.isArray(raw.steps) ? raw.steps.flatMap((value) => {
    const step = value && typeof value === "object" ? value as Record<string, unknown> : {};
    if (!ACTIONS.has(String(step.action))) return [];
    if (step.action !== "scroll" && !validRefs.has(String(step.targetRef))) return [];
    if ((step.action === "fill" || step.action === "select") && !writableRefs.has(String(step.targetRef))) return [];
    return [{
      action: String(step.action) as BrowserActionPlan["steps"][number]["action"],
      ...(validRefs.has(String(step.targetRef)) ? { targetRef: String(step.targetRef) } : {}),
      ...(typeof step.value === "string" ? { value: step.value.slice(0, 4_000) } : {}),
      ...(typeof step.amountPx === "number" ? { amountPx: Math.min(Math.max(step.amountPx, 0), 2_000) } : {}),
      reason: String(step.reason || "User-requested action.").slice(0, 240),
    }];
  }).slice(0, 1) : [];
  if (!steps.length) {
    return { kind: "blocked", reason: "No safe action could be matched to the current page.", recoverable: true };
  }
  return {
    kind: "action_plan",
    summary: String(raw.summary || "Proposed browser actions."),
    snapshotId: snapshot.snapshotId,
    requiresConfirmation: true,
    confidence: typeof raw.confidence === "number" ? Math.min(Math.max(raw.confidence, 0), 1) : 0,
    steps,
  };
}

export function completionEvidenceMatchesSnapshot(evidence: string, snapshot: PageSnapshot): boolean {
  const normalizedEvidence = normalizeEvidence(evidence);
  if (normalizedEvidence.length < 2) return false;
  const pageEvidence = [
    snapshot.url,
    snapshot.title,
    snapshot.selectedText,
    snapshot.mainText,
    snapshot.simplifiedDom,
    ...snapshot.headings.map((heading) => heading.text),
    ...snapshot.elements.flatMap((element) => [
      element.label,
      element.text,
      element.value ?? "",
      element.href ?? "",
      element.placeholder ?? "",
    ]),
  ].map(normalizeEvidence);
  return pageEvidence.some((candidate) => candidate.includes(normalizedEvidence));
}

function normalizeEvidence(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(text)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!candidate) throw new Error("Codex did not return JSON.");
  return JSON.parse(candidate);
}

function mockDecision(task: string, snapshot: PageSnapshot): AgentDecision {
  const performanceSummary = snapshot.performance
    ? `\nRequests: ${snapshot.performance.summary.requestCount}\nSlow requests: ${snapshot.performance.summary.slowRequestCount}`
    : "";
  return { kind: "answer", content: `Mock analysis for ${snapshot.title}\n\nTask: ${task}\nInteractive elements: ${snapshot.elements.length}${performanceSummary}` };
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
