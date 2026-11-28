// Short, repeatable baseline. No application conversations or data sources are read.
import { performance } from "node:perf_hooks";

const base = process.env.LLM_BASE_URL;
if (!base) throw new Error("LLM_BASE_URL is required (run inside the app container)");
const samples = Number(process.env.INFERENCE_BENCHMARK_SAMPLES ?? 3);
if (!Number.isSafeInteger(samples) || samples < 1 || samples > 20) throw new Error("Samples must be between 1 and 20");
const results = [];
for (let sample = 1; sample <= samples; sample++) {
  const started = performance.now();
  const response = await fetch(new URL("/api/chat", base), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.LLM_MODEL, messages: [{ role: "user", content: "Explain in a few sentences how a rain gauge measures rainfall." }], stream: true, think: false, options: { num_predict: 64, temperature: 0 } }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok || !response.body) throw new Error(`Ollama benchmark failed (HTTP ${response.status})`);
  let first = null, final = null, buffer = "";
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  const consume = line => {
    if (!line.trim()) return;
    const item = JSON.parse(line);
    if (item.error) throw new Error("Ollama benchmark returned an error");
    if (first === null && (item.message?.content || item.message?.thinking)) first = performance.now() - started;
    if (item.done) final = item;
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
    if (done) { consume(buffer); break; }
  }
  if (!final) throw new Error("Ollama benchmark ended without usage metrics");
  const ms = ns => typeof ns === "number" ? Math.round(ns / 1e6 * 10) / 10 : null;
  const result = {
    sample, model: final.model, elapsed_ms: Math.round(performance.now() - started), ttft_ms: first === null ? null : Math.round(first),
    load_ms: ms(final.load_duration), prompt_ms: ms(final.prompt_eval_duration), generation_ms: ms(final.eval_duration),
    prompt_tokens: final.prompt_eval_count ?? null, cached_prompt_tokens: final.prompt_eval_cached_count ?? null, output_tokens: final.eval_count ?? null,
    generation_tokens_per_second: final.eval_duration > 0 ? Math.round(final.eval_count / final.eval_duration * 1e10) / 10 : null,
  };
  results.push(result);
  console.error(`Sample ${sample}/${samples} complete`);
}
console.log(JSON.stringify({ measured_at: new Date().toISOString(), workload: "synthetic-short-prompt", thinking: false, max_output_tokens: 64, results }, null, 2));
