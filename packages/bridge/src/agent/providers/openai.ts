import type { AgentDecision, AgentRuntimeStatus, PageSnapshot } from "@auto-page-agent/shared";
import { loadSkills, selectSkillContext } from "../../skills.js";
import { extractJson, mockDecision, normalizeDecision } from "../decision.js";
import { createAgentPrompt } from "../prompt.js";
import { readResponsesError, readResponsesStream, responsesDecisionSchema } from "../responses.js";
import type { AgentEventSink, AgentRunContext } from "../types.js";

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
      return normalizeDecision(extractJson(streamed.text), snapshot, task);
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
