import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize } from "./inference-performance-report.mjs";

test("summary keeps absent token usage unknown, failures separate and repeated log exports idempotent", () => {
  const calls = [
    { event: "inference_call", schema: 1, id: "a", phase: "chat", model: "fixture", streaming: true, outcome: "completed", duration_ms: 1000, completion_tokens: 10, ttft_ms: 100 },
    { event: "inference_call", schema: 1, id: "b", phase: "chat", model: "fixture", streaming: true, outcome: "completed", duration_ms: 3000, completion_tokens: 30, ttft_ms: 200 },
    { event: "inference_call", schema: 1, id: "c", phase: "chat", model: "fixture", streaming: true, outcome: "failed", duration_ms: 999999, completion_tokens: null, ttft_ms: null },
    { event: "inference_call", schema: 1, id: "d", phase: "dashboard", model: "fixture", streaming: false, outcome: "completed", duration_ms: 5000, completion_tokens: null, ttft_ms: null },
  ];
  const result = summarize([...calls, ...calls, { event: "unrelated" }]);
  assert.equal(result.groups[0].requests, 3);
  assert.equal(result.groups[0].failed, 1);
  assert.deepEqual(result.groups[0].latency_ms, { p50: 1000, p95: 3000 });
  assert.equal(result.groups[0].effective_output_tokens_per_second, 10);
  assert.equal(result.groups[1].effective_output_tokens_per_second, null);
  assert.equal(result.groups[1].ttft_ms.samples, 0);
});
