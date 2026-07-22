import type { AgentDecision, BrowserActionPlan, PageSnapshot } from "@auto-page-agent/shared";
import { CodexAppServerClient } from "./codex-app-server.js";
import { loadSkills, selectSkills } from "./skills.js";

const ACTIONS = new Set(["click", "fill", "select", "scroll", "focus", "submit"]);

export interface AgentProvider {
  readonly name: string;
  run(task: string, snapshot: PageSnapshot): Promise<AgentDecision>;
}

export class CodexProvider implements AgentProvider {
  readonly name = "Local Codex";
  #client = new CodexAppServerClient();

  async run(task: string, snapshot: PageSnapshot): Promise<AgentDecision> {
    if (process.env.AUTO_PAGE_AGENT_MOCK === "1") return mockDecision(task, snapshot);
    const skills = selectSkills(task, await loadSkills());
    const thread = await this.#client.request<{ thread?: { id?: string } }>("thread/start", {
      approvalPolicy: "never",
      personality: "pragmatic",
      ephemeral: true,
      persistExtendedHistory: false,
    });
    const threadId = thread.thread?.id;
    if (!threadId) throw new Error("Codex did not return a thread id.");
    const prompt = createAgentPrompt(task, snapshot, skills.map((skill) => skill.body));
    return this.#runTurn(threadId, prompt, snapshot);
  }

  async #runTurn(threadId: string, prompt: string, snapshot: PageSnapshot): Promise<AgentDecision> {
    let turnId = "";
    let text = "";
    const completed = new Promise<void>((resolve, reject) => {
      const unsubscribe = this.#client.onNotification((notification) => {
        const params = notification.params ?? {};
        if (String(params.threadId ?? "") !== threadId) return;
        if (turnId && params.turnId && String(params.turnId) !== turnId) return;
        if (notification.method === "item/completed") {
          const item = params.item as { type?: string; text?: string } | undefined;
          if (item?.type === "agentMessage") text = item.text ?? text;
        }
        if (notification.method === "turn/completed") { unsubscribe(); resolve(); }
        if (notification.method === "turn/failed") { unsubscribe(); reject(new Error("Codex turn failed.")); }
      });
    });
    const turn = await this.#client.request<{ turn?: { id?: string } }>("turn/start", {
      threadId,
      input: [{ type: "text", text, text_elements: [] }].map((input) => ({ ...input, text: prompt })),
      effort: "low",
      approvalPolicy: "never",
    });
    turnId = turn.turn?.id ?? "";
    await withTimeout(completed, 40_000);
    return normalizeDecision(extractJson(text), snapshot);
  }
}

export function createAgentPrompt(task: string, snapshot: PageSnapshot, skills: string[]): string {
  return [
    "You are a current-page analysis and browser-action planner.",
    "Return exactly one JSON object without Markdown.",
    "For analysis or questions return: {\"kind\":\"answer\",\"content\":\"...\"}.",
    "For an explicit browser action return: {\"kind\":\"action_plan\",\"summary\":\"...\",\"snapshotId\":\"...\",\"requiresConfirmation\":true,\"confidence\":0.8,\"steps\":[{\"action\":\"click|fill|select|scroll|focus|submit\",\"targetRef\":\"element-1\",\"value\":\"...\",\"reason\":\"...\"}]}.",
    "Use only targetRef values present in the snapshot. Never output JavaScript, CSS selectors, XPath, payment, purchase, credential, or destructive actions.",
    "If the user only requests a draft, analysis, or explanation, do not create an action plan.",
    skills.length ? `Applicable skills:\n${skills.join("\n\n")}` : "",
    `User task:\n${task}`,
    `Page snapshot:\n${JSON.stringify(snapshot)}`,
  ].filter(Boolean).join("\n\n");
}

export function normalizeDecision(value: unknown, snapshot: PageSnapshot): AgentDecision {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (raw.kind !== "action_plan") return { kind: "answer", content: String(raw.content || "The agent returned no answer.") };
  const validRefs = new Set(snapshot.elements.map((element) => element.ref));
  const steps = Array.isArray(raw.steps) ? raw.steps.flatMap((value) => {
    const step = value && typeof value === "object" ? value as Record<string, unknown> : {};
    if (!ACTIONS.has(String(step.action))) return [];
    if (step.action !== "scroll" && !validRefs.has(String(step.targetRef))) return [];
    return [{
      action: String(step.action) as BrowserActionPlan["steps"][number]["action"],
      ...(validRefs.has(String(step.targetRef)) ? { targetRef: String(step.targetRef) } : {}),
      ...(typeof step.value === "string" ? { value: step.value.slice(0, 4_000) } : {}),
      ...(typeof step.amountPx === "number" ? { amountPx: Math.min(Math.max(step.amountPx, 0), 2_000) } : {}),
      reason: String(step.reason || "User-requested action.").slice(0, 240),
    }];
  }).slice(0, 4) : [];
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
