import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "@/lib/db";
import { apps, appThreads, chatTurns, dashboardArtifacts, dashboardVersions } from "@/lib/db/schema";
import { createArtifactStore } from "@/lib/dashboards/artifacts";
import { createDashboardService } from "@/lib/dashboards/service";
import { createDashboardGenerator, validateDocument } from "@/lib/dashboards/generation";
import { checkScript, runScript } from "@/lib/dashboards/sandbox";
import { createThreadService } from "@/lib/apps/threads";
import { createInferenceClient } from "@/lib/inference";
import { TEST_DATABASE_URL } from "./global-setup";

const { db, pool } = createDatabase(TEST_DATABASE_URL);
const artifacts = createArtifactStore(db);
const threads = createThreadService({ db });
const metadata = createDashboardService({ db });
const program = 'root = Dashboard([section])\nsection = Section("Revenue", [Kpis([Kpi("Total", @Sum(data.rows.revenue), "number")])])\ndata = Query("script_sales", {period: $period}, {rows: []})\n$period = "30d"';
const document = { program, scripts: { script_sales: 'return tools.sales({period: args.period});' } };
const source = { name: "sales", description: "Read sales", parameters: { type: "object", properties: { period: { type: "string" } } }, callers: ["dashboard"] as const,
  run: async () => ({ rows: [{ revenue: 10 }] }) };

beforeEach(async () => { await db.execute(sql`TRUNCATE ${apps} CASCADE`); });
afterAll(async () => { await pool.end(); });
async function app(userId = "alice") { return (await db.insert(apps).values({ userId, name: "Owned app" }).returning())[0].id; }

describe("owned artifacts and history", () => {
  it("imports a legacy document under its original id and refuses replacement or foreign ownership", async () => {
    const id = await app();
    await metadata.record("alice", id, { artifactId: "art_legacy", title: "Legacy" });
    await expect(artifacts.importLegacy("bob", id, "art_legacy", document)).rejects.toMatchObject({ status: 404 });
    await artifacts.importLegacy("alice", id, "art_legacy", document);
    expect(await artifacts.read("alice", id, "art_legacy")).toMatchObject(document);
    await expect(artifacts.importLegacy("alice", id, "art_legacy", document)).rejects.toMatchObject({ code: "version_conflict" });
  });

  it("imports an archived Cloud conversation idempotently and refuses to reorder new local turns", async () => {
    const id = await app();
    await threads.register("alice", id, { threadId: "conv_legacy", title: "Legacy chat" });
    const directory = await mkdtemp(join(tmpdir(), "od-history-import-"));
    try {
      const path = join(directory, "conversation.json");
      await writeFile(path, JSON.stringify({ metadata: { thread_id: "conv_legacy", app_id: id, user_id: "alice" }, items: [
        { id: "m1", type: "message", role: "user", content: "Original question" },
        { id: "m2", type: "message", role: "assistant", content: [{ type: "output_text", text: "Original answer" }] },
      ] }));
      const run = () => execFileSync(process.execPath, ["scripts/import-openui-history.mjs", path], {
        env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, stdio: "pipe",
      });
      run(); run();
      expect(await threads.messages("alice", id, "conv_legacy")).toMatchObject([
        { role: "user", content: "Original question" }, { role: "assistant", content: "Original answer" },
      ]);
      await threads.append("alice", id, "conv_legacy", "new-turn", [{ role: "user", content: "New question" }]);
      expect(run).toThrow("merge history explicitly");
    } finally { await rm(directory, { recursive: true }); }
  });

  it("creates, reloads, edits and deletes versions with tenant isolation", async () => {
    const id = await app();
    const other = await app("bob");
    const created = await artifacts.create("alice", id, "Revenue", document);
    expect(await artifacts.read("bob", id, created.id)).toBeNull();
    expect(await artifacts.read("alice", other, created.id)).toBeNull();
    await expect(artifacts.create("bob", id, "Stolen", document)).rejects.toMatchObject({ status: 404 });
    const changed = { ...document, program: program.replace('"Revenue"', '"Updated"') };
    expect((await artifacts.update("alice", id, created.id, 1, changed)).version).toBe(2);
    expect(await artifacts.read("alice", id, created.id, 1)).toMatchObject(document);
    expect(await artifacts.read("alice", id, created.id)).toMatchObject(changed);
    await expect(artifacts.update("alice", id, created.id, 1, document)).rejects.toMatchObject({ code: "version_conflict" });
    await expect(artifacts.update("bob", id, created.id, 2, document)).rejects.toMatchObject({ code: "version_conflict" });
    expect(await metadata.remove("alice", id, created.id)).toBe(true);
    expect(await artifacts.read("alice", id, created.id)).toBeNull();
    expect(await db.select().from(dashboardVersions)).toHaveLength(0);
  });

  it("appends stopped/tool turns idempotently and cascades all content on app deletion", async () => {
    const id = await app();
    const created = await threads.create("alice", id, "History");
    if (!created.ok) throw new Error("Thread create failed");
    const threadId = created.data.id;
    await threads.append("alice", id, threadId, "run1", [{ role: "user", content: "Revenue?" }, { role: "assistant", content: "Done" }]);
    await threads.append("alice", id, threadId, "run1", [{ role: "user", content: "Duplicate" }]);
    expect(await threads.messages("alice", id, threadId)).toHaveLength(2);
    expect(await threads.messages("bob", id, threadId)).toBeNull();
    await expect(threads.append("bob", id, threadId, "run2", [])).rejects.toThrow("Thread not found");
    await artifacts.create("alice", id, "Dashboard", document);
    await db.delete(apps).where(and(eq(apps.id, id), eq(apps.userId, "alice")));
    for (const table of [chatTurns, appThreads, dashboardArtifacts, dashboardVersions]) expect(await db.select().from(table)).toHaveLength(0);
  });
});

describe("QuickJS execution", () => {
  it("runs live data calls and filter arguments without inference", async () => {
    let total = 10;
    const sales = vi.fn(async (args: Record<string, unknown>) => ({ rows: [{ revenue: total, period: args.period }] }));
    const body = 'const data = tools.sales({period: args.period}); return {total: data.rows[0].revenue, period: data.rows[0].period};';
    expect(await runScript(body, { period: "30d" }, { sales })).toEqual({ total: 10, period: "30d" });
    total = 20;
    expect(await runScript(body, { period: "7d" }, { sales })).toEqual({ total: 20, period: "7d" });
    expect(sales).toHaveBeenCalledTimes(2);
  });

  it("has no host globals and does not leak state between runs", async () => {
    const body = 'globalThis.privateValue = 1; return [typeof process, typeof require, typeof fetch, typeof Buffer, typeof __callTool];';
    expect(await runScript(body, {}, {})).toEqual(["undefined", "undefined", "undefined", "undefined", "undefined"]);
    expect(await runScript('return typeof privateValue;', {}, {})).toBe("undefined");
    await expect(runScript('return tools.constructor.constructor("return process")();', {}, {})).rejects.toMatchObject({ code: "script_failed" });
  });

  it("bounds CPU, memory and tool calls, and aborts suspended tools", async () => {
    await expect(runScript('while(true){}', {}, {}, { cpuMs: 20 })).rejects.toMatchObject({ code: "script_failed" });
    await expect(runScript('return new Array(100000000).fill("x");', {}, {})).rejects.toBeTruthy();
    await expect(runScript('for(let i=0;i<3;i++) tools.sales({}); return 1;', {}, { sales: source.run }, { maxCalls: 2 })).rejects.toThrow("limit");
    const signal = AbortSignal.timeout(40);
    await expect(runScript('return tools.sales({});', {}, { sales: () => new Promise(() => {}) }, { signal })).rejects.toBeTruthy();
    await expect(checkScript('return };')).rejects.toMatchObject({ code: "invalid_script" });
  });
});

describe("generation over real HTTP to a local provider stand-in", () => {
  async function provider(replies: Array<{ status?: number; content?: unknown }>, run: (baseUrl: string, requests: Record<string, unknown>[]) => Promise<void>) {
    const requests: Record<string, unknown>[] = [];
    const server: Server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      requests.push({ path: request.url, ...JSON.parse(body) });
      const next = replies[Math.min(requests.length - 1, replies.length - 1)];
      response.writeHead(next.status ?? 200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(next.status ? { error: { message: "At capacity", type: "rate_limit_error", code: "429" } } : {
        id: "local", object: "chat.completion", created: 0, model: "owned-model", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: typeof next.content === "string" ? next.content : JSON.stringify(next.content) } }],
      }));
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No provider port");
      await run(`http://127.0.0.1:${address.port}/v1`, requests);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  }

  it("repairs invalid output locally, persists a valid document, and never calls Thesys", async () => {
    await provider([{ content: "invalid json" }, { content: document }], async (baseUrl, requests) => {
      const generate = createDashboardGenerator({ client: createInferenceClient({ baseUrl }), model: "owned-model", tools: [source] });
      const generated = await generate("Build revenue", new AbortController().signal);
      const id = await app();
      const stored = await artifacts.create("alice", id, "Revenue", generated);
      expect(await artifacts.read("alice", id, stored.id)).toMatchObject(document);
      expect(requests).toHaveLength(2);
      expect(requests.every((request) => request.path === "/v1/chat/completions" && request.model === "owned-model")).toBe(true);
      expect(JSON.stringify(requests)).not.toContain("]]>openui:config");
      expect(JSON.stringify(requests[1])).toContain("Repair the document");
    });
  });

  it("preserves upstream 429 and saves no dashboard on failure", async () => {
    await provider([{ status: 429 }], async (baseUrl) => {
      const client = createInferenceClient({ baseUrl }).withOptions({ maxRetries: 0 });
      await expect(createDashboardGenerator({ client, model: "owned-model", tools: [source] })("Build", new AbortController().signal)).rejects.toMatchObject({ status: 429 });
      expect(await db.select().from(dashboardArtifacts)).toHaveLength(0);
    });
  });

  it("rejects malformed programs, mutation calls, and unregistered queries", async () => {
    await expect(validateDocument({ ...document, program: 'root = Unknown([])' }, ["sales"])).rejects.toBeTruthy();
    await expect(validateDocument({ ...document, scripts: {} }, ["sales"])).rejects.toMatchObject({ code: "invalid_program" });
    await expect(validateDocument({ ...document, program: program + '\nwrite = Mutation("sales", {})' }, ["sales"])).rejects.toMatchObject({ code: "invalid_program" });
  });
});
