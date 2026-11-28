import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import type { InferenceCall, InferencePerformance } from "./measurements";
import { observeResponse } from "./observe-response";

type Timing = { call: InferenceCall; start: number; end: number };
type Context = { trace: string; phase: InferenceCall["phase"]; timings: Timing[]; signal?: AbortSignal };
const context = new AsyncLocalStorage<Context>();
const rounded = (value: number) => Math.round(value * 10) / 10;
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === "object" ? value as ObjectValue : {};

/** The HTTP requests inside a turn may overlap; measure their union, not their sum. */
export function createInferencePerformance(enabled: boolean, signal?: AbortSignal) {
  const started = performance.now();
  const store: Context = { trace: crypto.randomUUID(), phase: "chat", timings: [], signal };
  let finished: InferencePerformance | null = null;
  return {
    run<T>(fn: () => T): T { return enabled ? context.run(store, fn) : fn(); },
    finish(outcome: InferenceCall["outcome"]): InferencePerformance | null {
      if (!enabled) return null;
      if (finished) return finished;
      const duration = performance.now() - started;
      let until = started;
      let inference = 0;
      for (const timing of [...store.timings].sort((a, b) => a.start - b.start)) {
        const start = Math.max(started, timing.start, until);
        inference += Math.max(0, timing.end - start);
        until = Math.max(until, timing.end);
      }
      finished = { trace_id: store.trace, outcome, duration_ms: rounded(duration), inference_ms: rounded(inference), other_ms: rounded(Math.max(0, duration - inference)), calls: store.timings.map(timing => timing.call) };
      console.info(JSON.stringify({ event: "inference_turn", schema: 1, at: new Date().toISOString(), ...finished }));
      return finished;
    },
  };
}

export function withInferencePhase<T>(phase: InferenceCall["phase"], fn: () => T): T {
  const current = context.getStore();
  return current ? context.run({ ...current, phase }, fn) : fn();
}

/** Times each actual HTTP attempt, including retries made inside the SDK. */
export function measuredInferenceFetch(baseFetch: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const owner = context.getStore();
    const started = performance.now();
    let metadata: ObjectValue = {};
    try { if (typeof init?.body === "string") metadata = object(JSON.parse(init.body)); } catch { /* Let the provider validate the body. */ }
    const model = typeof metadata.model === "string" && /^[a-zA-Z0-9._/:@+-]{1,160}$/.test(metadata.model) ? metadata.model : "unknown";
    const streaming = metadata.stream === true;
    let first: number | null = null;
    let output: number | null = null;
    let usage: ObjectValue = {};
    let status: number | null = null;
    let terminal = false;
    let recorded = false;
    const record = (outcome: InferenceCall["outcome"]) => {
      if (recorded) return;
      recorded = true;
      const ended = performance.now();
      const duration = ended - started;
      const tokens = number(usage.completion_tokens);
      const call: InferenceCall = {
        id: crypto.randomUUID(), phase: owner?.phase ?? "chat", model, streaming, outcome, status,
        duration_ms: rounded(duration), ttft_ms: first === null ? null : rounded(first - started),
        first_output_ms: output === null ? null : rounded(output - started),
        prompt_tokens: number(usage.prompt_tokens), cached_prompt_tokens: number(object(usage.prompt_tokens_details).cached_tokens),
        completion_tokens: tokens, tokens_per_second: tokens === null || duration <= 0 ? null : rounded(tokens * 1000 / duration),
      };
      owner?.timings.push({ call, start: started, end: ended });
      console.info(JSON.stringify({ event: "inference_call", schema: 1, at: new Date().toISOString(), trace_id: owner?.trace ?? null, ...call }));
    };
    try {
      const response = await baseFetch(input, init);
      status = response.status;
      return observeResponse(response, raw => {
        const chunk = object(raw);
        if (chunk.usage) usage = object(chunk.usage);
        const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
        for (const choice of choices) {
          const item = object(choice);
          if (item.finish_reason) terminal = true;
          const delta = object(item.delta);
          const text = typeof delta.content === "string" && delta.content.length > 0;
          const tools = Array.isArray(delta.tool_calls) && delta.tool_calls.some(rawCall => {
            const fn = object(object(rawCall).function);
            return !!fn.name || !!fn.arguments;
          });
          const thinking = [delta.reasoning, delta.reasoning_content].some(value => typeof value === "string" && value.length > 0);
          if (streaming && first === null && (text || tools || thinking)) first = performance.now();
          if (streaming && output === null && (text || tools)) output = performance.now();
        }
      }, end => {
        const outcome = !response.ok || end === "completed" && streaming && !terminal ? "failed"
          : end === "cancelled" && terminal ? "completed"
          : end === "cancelled" && owner?.signal && !owner.signal.aborted ? "failed" : end;
        record(outcome);
      }, init?.signal);
    } catch (error) {
      record(owner?.signal ? owner.signal.aborted ? "cancelled" : "failed" : init?.signal?.aborted ? "cancelled" : "failed");
      throw error;
    }
  };
}
