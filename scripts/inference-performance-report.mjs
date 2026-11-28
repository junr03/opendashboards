import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
};
const valid = value => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Consume only our versioned, content-free records; unrelated app logs are ignored. */
export function summarize(records) {
  const calls = records.filter(r => r.event === "inference_call" && r.schema === 1 && typeof r.id === "string");
  const turns = records.filter(r => r.event === "inference_turn" && r.schema === 1 && typeof r.trace_id === "string");
  const uniqueCalls = [...new Map(calls.map(call => [call.id, call])).values()];
  const uniqueTurns = [...new Map(turns.map(turn => [turn.trace_id, turn])).values()];
  const groups = new Map();
  for (const call of uniqueCalls) {
    const key = JSON.stringify([call.phase, call.model, call.streaming]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(call);
  }
  return {
    turns: uniqueTurns.length,
    turn_outcomes: Object.fromEntries(["completed", "failed", "cancelled"].map(outcome => [outcome, uniqueTurns.filter(t => t.outcome === outcome).length])),
    turn_ms: { p50: percentile(uniqueTurns.map(t => t.duration_ms).filter(valid), .5), p95: percentile(uniqueTurns.map(t => t.duration_ms).filter(valid), .95) },
    groups: [...groups.values()].map(group => {
      const completed = group.filter(c => c.outcome === "completed");
      const withUsage = completed.filter(c => valid(c.completion_tokens) && valid(c.duration_ms) && c.duration_ms > 0);
      const duration = withUsage.reduce((sum, c) => sum + c.duration_ms, 0);
      return {
        phase: group[0].phase, model: group[0].model, streaming: group[0].streaming,
        requests: group.length, completed: completed.length, failed: group.filter(c => c.outcome === "failed").length, cancelled: group.filter(c => c.outcome === "cancelled").length,
        latency_ms: { p50: percentile(completed.map(c => c.duration_ms).filter(valid), .5), p95: percentile(completed.map(c => c.duration_ms).filter(valid), .95) },
        ttft_ms: { p50: percentile(completed.map(c => c.ttft_ms).filter(valid), .5), p95: percentile(completed.map(c => c.ttft_ms).filter(valid), .95), samples: completed.filter(c => valid(c.ttft_ms)).length },
        calls_with_token_usage: withUsage.length,
        effective_output_tokens_per_second: duration > 0 ? withUsage.reduce((sum, c) => sum + c.completion_tokens, 0) * 1000 / duration : null,
      };
    }),
  };
}

async function main() {
  const records = [];
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const start = line.indexOf('{"event":"inference_');
    if (start < 0) continue;
    try { records.push(JSON.parse(line.slice(start))); } catch { /* Partial/unrelated log line. */ }
  }
  const result = summarize(records);
  if (process.argv.includes("--json")) { console.log(JSON.stringify(result, null, 2)); return; }
  console.log(`Turns: ${result.turns} (${result.turn_outcomes.completed} completed, ${result.turn_outcomes.failed} failed, ${result.turn_outcomes.cancelled} cancelled)`);
  console.log(`Turn latency: p50 ${result.turn_ms.p50 ?? "—"} ms; p95 ${result.turn_ms.p95 ?? "—"} ms`);
  console.table(result.groups.map(g => ({ phase: g.phase, model: g.model, mode: g.streaming ? "streamed" : "buffered", requests: g.requests, failed: g.failed, cancelled: g.cancelled, p50_ms: g.latency_ms.p50, p95_ms: g.latency_ms.p95, ttft_p50_ms: g.ttft_ms.p50, usage_samples: g.calls_with_token_usage, effective_tok_s: g.effective_output_tokens_per_second?.toFixed(2) ?? "—" })));
  console.log("Effective throughput includes loading, queueing, prompt processing and generation. Missing measurements remain unknown. Percentiles use completed requests; inspect failures/cancellations too. Small samples have unstable p95 values.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
