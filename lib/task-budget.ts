import type { ToolSet } from "ai";
import { AGENT_TOOL_LIMIT, AGENT_TASK_TIMEOUT_MS, AGENT_TOOL_TIMEOUT_MS, AGENT_MODEL_FIRST_TIMEOUT_MS, AGENT_MODEL_IDLE_TIMEOUT_MS } from "./tool-catalog";
import { modelHttpError } from "./model-errors";
import { getAgentStepLimit } from "./agent-config";
import { toolFinding } from "./tool-findings";

export type StopReason = "step_limit" | "tool_limit" | "time_limit" | "tool_error" | "provider_error" | "cancelled";
export type ToolFailure = { tool: string; message: string };
export const SOURCE_TIMEOUT_MESSAGE = "źródło nie odpowiada";
type TaskLimits = { steps: number; tools: number; taskMs: number; toolMs: number; modelFirstMs?: number; modelIdleMs?: number };

export class TaskBudget {
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  readonly findings = new Set<string>();
  readonly failures: ToolFailure[] = [];
  readonly blockedToolCallIds = new Set<string>();
  reason?: StopReason;
  message?: string;
  modelSteps = 0;
  stepsCompleted = 0;
  toolCalls = 0;
  private reservedSearch = false;
  private nativeUsed = false;
  private startedIds = new Set<string>();
  private startedAt = performance.now();
  private timer: ReturnType<typeof setTimeout>;
  private detach: () => void;

  constructor(clientSignal?: AbortSignal, readonly limits: TaskLimits = { steps: getAgentStepLimit(), tools: AGENT_TOOL_LIMIT, taskMs: AGENT_TASK_TIMEOUT_MS, toolMs: AGENT_TOOL_TIMEOUT_MS }) {
    this.timer = setTimeout(() => this.stop("time_limit", "Upłynął limit 60 sekund na zadanie.", true), limits.taskMs);
    const cancel = () => this.stop("cancelled", "Przerwane przez użytkownika", true);
    clientSignal?.addEventListener("abort", cancel, { once: true });
    this.detach = () => clientSignal?.removeEventListener("abort", cancel);
    if (clientSignal?.aborted) cancel();
  }
  stop(reason: StopReason, message: string, abort = false) {
    if (!this.reason || reason === "time_limit" || (reason === "tool_error" && ["step_limit", "tool_limit"].includes(this.reason))) {
      this.reason = reason; this.message = message;
    }
    if (abort && !this.signal.aborted) this.controller.abort(new Error(message));
  }
  fail(tool: string, message: string, abort = false) {
    const safe = message.slice(0, 700);
    if (!this.failures.some(failure => failure.tool === tool && failure.message === safe)) this.failures.push({ tool, message: safe });
    this.stop("tool_error", `Nie udało się sprawdzić: ${tool}. ${safe}`, abort);
  }
  beginStep(step: number, nativeSearch: boolean) {
    this.modelSteps = Math.max(this.modelSteps, step + 1);
    // Native search nie ma execute ani osobnego zdarzenia startu. Jeden slot
    // rezerwujemy przed żądaniem i rozliczamy raz na podstawie cytowań.
    this.reservedSearch = nativeSearch && this.toolCalls < this.limits.tools;
    this.nativeUsed = false;
  }
  nativeSearchUsed() {
    if (this.nativeUsed) return;
    this.nativeUsed = true;
    if (this.reservedSearch) { this.reservedSearch = false; this.toolCalls++; }
    if (this.toolCalls >= this.limits.tools) this.stop("tool_limit", "Zatrzymałem się przed przekroczeniem limitu 16 wywołań narzędzi.");
  }
  endStep(step: number, localCalls: boolean, finishReason: string) {
    this.stepsCompleted = Math.max(this.stepsCompleted, step + 1);
    this.reservedSearch = false;
    if (this.stepsCompleted >= this.limits.steps && localCalls && !["error", "interrupted", "length", "content-filter"].includes(finishReason)) {
      this.stop("step_limit", `Zatrzymałem się po ${this.limits.steps} krokach`);
    }
  }
  addFinding(tool: string, output: unknown) {
    const finding = toolFinding(tool, output);
    if (finding && !finding.startsWith("Błąd") && this.findings.size < 24) this.findings.add(finding);
  }
  metadata() {
    return {
      modelSteps: this.modelSteps, stepsCompleted: this.stepsCompleted, stepLimit: this.limits.steps, toolCalls: this.toolCalls,
      durationMs: Math.max(0, Math.round(performance.now() - this.startedAt)),
      stepLimitReached: this.reason === "step_limit", stopReason: this.reason, stopMessage: this.message,
      partialFindings: this.reason ? [...this.findings] : undefined,
      toolFailures: this.failures.length ? [...this.failures] : undefined,
      blockedToolCallIds: this.blockedToolCallIds.size ? [...this.blockedToolCallIds] : undefined,
    };
  }
  dispose() { clearTimeout(this.timer); this.detach(); }

  async waitFor<T>(value: PromiseLike<T>, signal = this.signal): Promise<T> {
    if (signal.aborted) throw signal.reason;
    let detach = () => {};
    const aborted = new Promise<never>((_, reject) => {
      const onAbort = () => reject(signal.reason ?? new Error("Przerwano zadanie"));
      signal.addEventListener("abort", onAbort, { once: true });
      detach = () => signal.removeEventListener("abort", onAbort);
    });
    try { return await Promise.race([Promise.resolve(value), aborted]); } finally { detach(); }
  }

  private errorOutput(tool: string, message: string) {
    return tool === "generujObraz" || tool === "odpowiedzPoPolsku"
      ? { ok: false as const, error: message }
      : { ok: false as const, message, retrievedAt: new Date().toISOString() };
  }
  async runTool(tool: string, id: string, execute: (signal: AbortSignal) => unknown | PromiseLike<unknown>, sdkSignal?: AbortSignal) {
    if (this.reason || this.startedIds.has(id) || this.toolCalls + Number(this.reservedSearch) >= this.limits.tools) {
      this.blockedToolCallIds.add(id);
      if (!this.reason) this.stop("tool_limit", "Zatrzymałem się przed przekroczeniem limitu 16 wywołań narzędzi.");
      return this.errorOutput(tool, "Nie uruchomiono narzędzia: zadanie zostało zakończone lub wyczerpano budżet wywołań.");
    }
    this.startedIds.add(id); this.toolCalls++;
    const timeout = new AbortController();
    const signal = AbortSignal.any([this.signal, timeout.signal, ...(sdkSignal ? [sdkSignal] : [])]);
    const timer = setTimeout(() => timeout.abort(new Error(SOURCE_TIMEOUT_MESSAGE)), this.limits.toolMs);
    try {
      const output = await this.waitFor(Promise.resolve().then(() => execute(signal)), signal);
      if (output && typeof output === "object" && "ok" in output && output.ok === false) {
        const result = output as { message?: unknown; error?: unknown };
        this.fail(tool, typeof result.message === "string" ? result.message : typeof result.error === "string" ? result.error : "Narzędzie nie zwróciło poprawnego wyniku.");
      } else this.addFinding(tool, output);
      if (this.toolCalls >= this.limits.tools) this.stop("tool_limit", "Zatrzymałem się przed przekroczeniem limitu 16 wywołań narzędzi.");
      return output;
    } catch {
      const message = timeout.signal.aborted ? SOURCE_TIMEOUT_MESSAGE : this.signal.aborted ? this.message || "Przerwano zadanie." : "Nie udało się uzyskać poprawnego wyniku narzędzia.";
      if (!this.signal.aborted) this.fail(tool, message);
      return this.errorOutput(tool, message);
    } finally { clearTimeout(timer); }
  }
}

export function guardTools<T extends ToolSet>(tools: T, budget: TaskBudget): T {
  return Object.fromEntries(Object.entries(tools).map(([name, definition]) => {
    const execute = definition.execute;
    return [name, !execute ? definition : { ...definition, execute: (input: unknown, options: Parameters<typeof execute>[1]) =>
      budget.runTool(name, options.toolCallId, signal => execute(input, { ...options, abortSignal: signal }), options.abortSignal) }];
  })) as T;
}

// Odpowiedź modelu i native search współdzielą stream. Limit narzędzia 10 s
// nie obejmuje modelu: czekamy do 45 s na pierwsze dane, potem do 20 s ciszy.
// Globalny budżet 60 s obowiązuje przez cały czas, także przy keep-alive.
export async function boundedModelFetch(url: RequestInfo | URL, init: RequestInit | undefined, budget: TaskBudget) {
  const source = new AbortController();
  const signal = AbortSignal.any([budget.signal, source.signal, ...(init?.signal ? [init.signal] : [])]);
  let timer: ReturnType<typeof setTimeout>;
  const arm = (idle: boolean) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const message = idle
        ? "[OPENROUTER_IDLE_TIMEOUT] Model przestał przesyłać dane. Zachowano dostępny wynik częściowy."
        : "[OPENROUTER_FIRST_TIMEOUT] Model nie rozpoczął przesyłania odpowiedzi w wyznaczonym czasie. Spróbuj ponownie.";
      budget.stop("provider_error", message, true);
      source.abort(new Error(message));
    }, idle ? budget.limits.modelIdleMs ?? AGENT_MODEL_IDLE_TIMEOUT_MS : budget.limits.modelFirstMs ?? AGENT_MODEL_FIRST_TIMEOUT_MS);
  };
  const clear = () => { clearTimeout(timer); signal.removeEventListener("abort", clear); };
  arm(false);
  signal.addEventListener("abort", clear, { once: true });
  try {
    const response = await budget.waitFor(fetch(url, { ...init, signal }), signal);
    if (!response.ok && !budget.reason) budget.stop("provider_error", modelHttpError(response.status));
    if (!response.ok || !response.body) { clear(); return response; }
    const reader = response.body.getReader();
    return new Response(new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await budget.waitFor(reader.read(), signal);
          if (done) { clear(); controller.close(); }
          else { if (value.byteLength) arm(true); controller.enqueue(value); }
        } catch (error) {
          clear(); void reader.cancel().catch(() => {});
          if (!budget.reason) budget.stop("provider_error", modelHttpError());
          controller.error(error);
        }
      },
      cancel() { clear(); source.abort(); return reader.cancel(); },
    }), { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    clear();
    if (!budget.reason && !signal.aborted) budget.stop("provider_error", "[OPENROUTER_CONNECTION] Nie udało się połączyć z OpenRouter. Sprawdź połączenie i spróbuj ponownie.");
    throw error;
  }
}
