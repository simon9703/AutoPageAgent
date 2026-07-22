import type { AgentDecision, AgentEvent, AgentLoopContext, AgentRuntimeStatus, BrowserActionPlan, ChatMessage, CodexRuntimeStatus, PageSnapshot, SkillSelection } from "@auto-page-agent/shared";
import { CodexAppServerClient } from "./codex-app-server.js";
import { loadSkills, selectSkillContext } from "./skills.js";

const ACTIONS = new Set(["click", "fill", "select", "scroll", "focus", "submit"]);

export interface AgentRunContext {
  conversationId: string;
  history: ChatMessage[];
  loop?: AgentLoopContext;
}

export type AgentEventSink = (event: AgentEvent) => void;
type EventWithoutMeta<T> = T extends unknown ? Omit<T, "id" | "timestamp"> : never;
type AgentEventInput = EventWithoutMeta<AgentEvent>;

export class CodexProvider {
  readonly name = "Local Codex";
  #client = new CodexAppServerClient();
  #threads = new Map<string, string>();

  async status(): Promise<CodexRuntimeStatus> {
    if (process.env.AUTO_PAGE_AGENT_MOCK === "1") return { available: true, authenticated: true, authMode: "chatgpt", command: "mock" };
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

  async run(task: string, snapshot: PageSnapshot, context: AgentRunContext, onEvent?: AgentEventSink): Promise<AgentDecision> {
    if (process.env.AUTO_PAGE_AGENT_MOCK === "1") return mockDecision(task, snapshot);
    const status = await this.status();
    if (!status.available || !status.authenticated) throw new Error(status.error || "Local Codex is unavailable.");
    const skills = selectSkillContext(task, await loadSkills(), snapshot.url);
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
    return this.#runTurn(threadId, prompt, snapshot, onEvent);
  }

  async #runTurn(threadId: string, prompt: string, snapshot: PageSnapshot, onEvent?: AgentEventSink): Promise<AgentDecision> {
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
          if (delta) { text += delta; emit(onEvent, { type: "thinking", content: delta, delta: true }); }
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
      await withTimeout(completed, 40_000);
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

  async run(task: string, snapshot: PageSnapshot, context: AgentRunContext, onEvent?: AgentEventSink): Promise<AgentDecision> {
    if (!this.#apiKey) throw new Error("OPENAI_API_KEY is not configured in the local bridge.");
    if (process.env.AUTO_PAGE_AGENT_MOCK === "1") return mockDecision(task, snapshot);
    const skills = selectSkillContext(task, await loadSkills(), snapshot.url);
    const previousResponseId = this.#previousResponses.get(context.conversationId);
    const prompt = createAgentPrompt(task, snapshot, skills.map((skill) => skill.body), previousResponseId ? [] : context.history, context.loop, skills);
    const userContent: Array<Record<string, unknown>> = [{ type: "input_text", text: prompt }];
    const imageUrl = snapshot.context?.selectedElement?.image?.src;
    if (imageUrl && /^(?:https?:|data:image\/)/iu.test(imageUrl)) userContent.push({ type: "input_image", image_url: imageUrl, detail: "auto" });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
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
      const streamed = await readResponsesStream(response, onEvent);
      if (streamed.responseId) this.#previousResponses.set(context.conversationId, streamed.responseId);
      return normalizeDecision(extractJson(streamed.text), snapshot);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("OpenAI Responses API timed out.");
      throw error;
    } finally { clearTimeout(timeout); }
  }
}

export class AgentRouter {
  readonly codex = new CodexProvider();
  readonly openai: OpenAIResponsesProvider;

  constructor(openai = new OpenAIResponsesProvider()) { this.openai = openai; }

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
    emit(onEvent, { type: "observe", snapshotId: snapshot.snapshotId, summary: context.loop ? `Observed loop step ${context.loop.iteration + 1}` : "Observed current page" });
    emit(onEvent, { type: "thinking", content: "Planning the next safe browser step…" });
    const selectedSkills = selectSkillContext(task, await loadSkills(), snapshot.url);
    const decision = status.id === "openai"
      ? await this.openai.run(task, snapshot, context, onEvent)
      : await this.codex.run(task, snapshot, context, onEvent);
    if (decision.kind === "action_plan") emit(onEvent, { type: "plan", summary: decision.summary, stepCount: decision.steps.length });
    else emit(onEvent, { type: "complete", summary: decision.content.slice(0, 240) });
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
    kind: { type: "string", enum: ["answer", "action_plan"] },
    content: { type: "string" },
    summary: { type: "string" },
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

export async function readResponsesStream(response: Response, onEvent?: AgentEventSink): Promise<{ text: string; responseId?: string }> {
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
      emit(onEvent, { type: "thinking", content: event.delta, delta: true });
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
  return [
    "You are a current-page observe-plan-act-verify browser agent.",
    "Return exactly one JSON object without Markdown.",
    "For analysis, completion, or questions return: {\"kind\":\"answer\",\"content\":\"...\"}.",
    "For an explicit browser action return: {\"kind\":\"action_plan\",\"summary\":\"...\",\"snapshotId\":\"...\",\"requiresConfirmation\":true,\"confidence\":0.8,\"steps\":[{\"action\":\"click|fill|select|scroll|focus|submit\",\"targetRef\":\"element-ref\",\"value\":\"...\",\"reason\":\"...\"}]}.",
    "Plan exactly one next action. The runtime observes and verifies the page again before asking for another action.",
    "Use only data-ai-ref values present in simplifiedDom as targetRef. Prefer visible, unoccluded, enabled elements. Never output JavaScript, CSS selectors, XPath, payment, purchase, credential, destructive, or final irreversible actions.",
    "If the goal is already satisfied, verification failed without a safe recovery, or the user only requested analysis, return an answer instead of an action plan.",
    selectedSkills.length ? `Selected Skill context:\n${selectedSkills.map((skill) => `${skill.name} (${skill.scope}): ${skill.reason}`).join("\n")}` : "",
    skills.length ? `Applicable skills:\n${skills.join("\n\n")}` : "",
    history.length ? `Recent conversation:\n${history.slice(-12).map((message) => `${message.role}: ${message.content}`).join("\n")}` : "",
    loopState ? `Loop state:\n${JSON.stringify(loopState)}` : "",
    `User task:\n${task}`,
    `Page snapshot:\n${JSON.stringify({ ...snapshot, elements: undefined })}`,
  ].filter(Boolean).join("\n\n");
}

export function normalizeDecision(value: unknown, snapshot: PageSnapshot): AgentDecision {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (raw.kind !== "action_plan") return { kind: "answer", content: String(raw.content || "The agent returned no answer.") };
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
  if (!steps.length) return { kind: "answer", content: "No safe action could be matched to the current page." };
  return {
    kind: "action_plan",
    summary: String(raw.summary || "Proposed browser actions."),
    snapshotId: snapshot.snapshotId,
    requiresConfirmation: true,
    confidence: typeof raw.confidence === "number" ? Math.min(Math.max(raw.confidence, 0), 1) : 0,
    steps,
  };
}

export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(text)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!candidate) throw new Error("Codex did not return JSON.");
  return JSON.parse(candidate);
}

function mockDecision(task: string, snapshot: PageSnapshot): AgentDecision {
  return { kind: "answer", content: `Mock analysis for ${snapshot.title}\n\nTask: ${task}\nInteractive elements: ${snapshot.elements.length}\nRequests: ${snapshot.performance.summary.requestCount}\nSlow requests: ${snapshot.performance.summary.slowRequestCount}` };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Codex turn timed out.")), timeoutMs); })]); }
  finally { if (timeout) clearTimeout(timeout); }
}
