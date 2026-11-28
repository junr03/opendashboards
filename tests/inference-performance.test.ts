import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import OpenAI from "openai";
import { createInferencePerformance, measuredInferenceFetch, withInferencePhase } from "@/lib/inference/performance";
import { observeResponse } from "@/lib/inference/observe-response";

afterEach(() => vi.restoreAllMocks());

async function fixture(run: (url: string, attempts: () => number) => Promise<void>) {
  let attempts = 0;
  const server = createServer(async (request, response) => {
    attempts++;
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    if (body.model === "retry" && attempts === 1) { response.writeHead(503); response.end('{"error":{"message":"private-error","type":"server_error"}}'); return; }
    if (!body.stream) { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ id: "fixture", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "private-output" } }], usage: { prompt_tokens: 100, completion_tokens: 20 } })); return; }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (value: unknown) => response.write(`data: ${JSON.stringify(value)}\r\n\r\n`);
    send({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
    await delay(15);
    send({ id: "fixture", choices: [{ delta: { reasoning: "private-thinking" }, finish_reason: null }] });
    await delay(15);
    send({ id: "fixture", choices: [{ delta: { content: "private-output" }, finish_reason: null }] });
    send({ id: "fixture", choices: [{ delta: {}, finish_reason: "stop" }] });
    send({ id: "fixture", choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 10 } } });
    response.end("data: [DONE]\r\n\r\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  try { await run(`http://127.0.0.1:${address.port}`, () => attempts); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

describe("inference observations", () => {
  it("forwards real streamed responses unchanged, distinguishes thinking/output, and logs no content", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await fixture(async url => {
      const profile = createInferencePerformance(true);
      await profile.run(async () => {
        const response = await measuredInferenceFetch()(url, { method: "POST", headers: { Authorization: "Bearer private-key" }, body: JSON.stringify({ model: "qwen3:8b", messages: [{ content: "private-prompt" }], stream: true }) });
        expect(await response.text()).toContain("private-output");
      });
      const report = profile.finish("completed")!;
      expect(report.calls).toHaveLength(1);
      expect(report.calls[0]).toMatchObject({ phase: "chat", outcome: "completed", prompt_tokens: 100, completion_tokens: 20, cached_prompt_tokens: 10 });
      expect(report.calls[0].ttft_ms).toBeGreaterThan(0);
      expect(report.calls[0].first_output_ms!).toBeGreaterThanOrEqual(report.calls[0].ttft_ms!);
      expect(report.calls[0].tokens_per_second).toBeGreaterThan(0);
      expect(report.inference_ms).toBeLessThanOrEqual(report.duration_ms);
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-(key|prompt|output|thinking)/);
    });
  });

  it("records each SDK retry and buffered dashboard call without inventing first-token latency", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await fixture(async (url, attempts) => {
      const profile = createInferencePerformance(true);
      const client = new OpenAI({ baseURL: url, apiKey: "fixture", fetch: measuredInferenceFetch(), maxRetries: 1 });
      await profile.run(() => withInferencePhase("dashboard", () => client.chat.completions.create({ model: "retry", messages: [{ role: "user", content: "private-prompt" }] })));
      expect(attempts()).toBe(2);
      expect(profile.finish("completed")!.calls).toMatchObject([
        { phase: "dashboard", status: 503, outcome: "failed", prompt_tokens: null, completion_tokens: null },
        { phase: "dashboard", status: 200, outcome: "completed", ttft_ms: null, first_output_ms: null, prompt_tokens: 100, completion_tokens: 20 },
      ]);
    });
  });

  it("separates concurrent turns and avoids double-counting overlapping inference", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await fixture(async url => {
      const a = createInferencePerformance(true), b = createInferencePerformance(true);
      const call = async () => (await measuredInferenceFetch()(url, { method: "POST", body: JSON.stringify({ model: "qwen3:8b", stream: true }) })).text();
      await Promise.all([a.run(() => Promise.all([call(), call()])), b.run(() => withInferencePhase("dashboard", call))]);
      const first = a.finish("completed")!, second = b.finish("completed")!;
      expect(first.trace_id).not.toBe(second.trace_id);
      expect(first.calls).toHaveLength(2);
      expect(second.calls).toHaveLength(1);
      expect(first.calls.every(c => c.phase === "chat")).toBe(true);
      expect(second.calls[0].phase).toBe("dashboard");
      expect(first.inference_ms).toBeLessThan(first.calls.reduce((sum, call) => sum + call.duration_ms, 0));
    });
  });

  it("propagates cancellation to the upstream body and records it once", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const cancelled = vi.fn();
    const profile = createInferencePerformance(true);
    await profile.run(async () => {
      const fetch = measuredInferenceFetch(async () => new Response(new ReadableStream({ cancel: cancelled }), { headers: { "Content-Type": "text/event-stream" } }));
      const response = await fetch("http://fixture", { body: JSON.stringify({ model: "qwen3:8b", stream: true }) });
      await response.body!.cancel();
    });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(profile.finish("cancelled")!.calls).toMatchObject([{ outcome: "cancelled", completion_tokens: null }]);
  });

  it("does not mistake a truncated stream for successful generation", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const profile = createInferencePerformance(true);
    await profile.run(async () => {
      const fetch = measuredInferenceFetch(async () => new Response('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n', { headers: { "Content-Type": "text/event-stream" } }));
      await (await fetch("http://fixture", { body: '{"model":"qwen3:8b","stream":true}' })).text();
    });
    expect(profile.finish("failed")!.calls).toMatchObject([{ outcome: "failed", ttft_ms: null }]);
  });

  it("observes fragmented SSE bytes without altering them or treating malformed frames as measurements", async () => {
    const bytes = new TextEncoder().encode('data: {"message":"é"}\r\n\r\ndata: nope\n\ndata: [DONE]\n\n');
    const seen: unknown[] = [], ends: string[] = [];
    const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
    const observed = observeResponse(response, value => seen.push(value), end => ends.push(end));
    expect(new Uint8Array(await observed.arrayBuffer())).toEqual(bytes);
    expect(seen).toEqual([{ message: "é" }]);
    expect(ends).toEqual(["completed"]);
  });

  it("leaves disabled turns unobserved", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const profile = createInferencePerformance(false);
    expect(profile.run(() => 42)).toBe(42);
    expect(profile.finish("completed")).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it("records network failures without logging error contents and distinguishes caller aborts", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    for (const abort of [false, true]) {
      const controller = new AbortController();
      if (abort) controller.abort();
      const profile = createInferencePerformance(true, controller.signal);
      await expect(profile.run(() => measuredInferenceFetch(async () => { throw new Error("private-network-error"); })("http://fixture", { signal: controller.signal }))).rejects.toThrow("private-network-error");
      expect(profile.finish(abort ? "cancelled" : "failed")!.calls).toMatchObject([{ outcome: abort ? "cancelled" : "failed", status: null, completion_tokens: null }]);
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-network-error");
  });
});
