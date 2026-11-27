// End-to-end verification against a local OpenAI-compatible stand-in, never a paid model.
// Requires migrated Postgres, Playwright Chromium, and a production build by default.
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { parseMessage } from "@openuidev/lang-core";
import pg from "pg";

const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://opendashboards:opendashboards@127.0.0.1:54329/opendashboards_test";
if (!new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("Browser smoke checks require a database whose name ends in _test");
const db = new pg.Client({ connectionString: databaseUrl });
await db.connect();
const appId = randomUUID();
const userId = `smoke_${randomUUID()}`;
const port = Number(process.env.SMOKE_PORT ?? 3210);
const origin = `http://127.0.0.1:${port}`;
const password = randomUUID();
let appServer;
let serverLog = "";
let browser;
let containerName;
const network = [];
let requests = 0;
let latestArtifact;
const revised = (program) => program.replace('"Owned revenue"', '"Owned revenue revised"');
const program = `root = Dashboard([filters, section])
$period = "30d"
data = Query("script_sales", {period: $period}, {total: 0})
filters = FilterBar([ChipFilter($period, [{value: "7d", label: "7 days"}, {value: "30d", label: "30 days"}], "Period")])
section = Section("Owned revenue", [Kpis([Kpi("Fixture total", data.total, "number")])])`;
const model = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const input = JSON.parse(body);
  requests++;
  if (request.url !== "/v1/chat/completions") { response.writeHead(501).end(); return; }
  if (!input.stream) {
    const isEdit = input.messages.some((message) => message.content?.includes("Requested edit:"));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: randomUUID(), object: "chat.completion", created: 0, model: "fixture-model",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        program: isEdit ? revised(program) : program,
        scripts: { script_sales: 'return {total: args.period === "7d" ? 70 : 300};' },
      }) } }],
    }));
    return;
  }
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const last = input.messages.at(-1);
  const chunk = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({
    id: "fixture-stream", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices: [{ index: 0, delta, finish_reason }],
  })}\n\n`);
  if (last.role === "tool") {
    latestArtifact = parseMessage(last.content).attributes.artifact_id ?? latestArtifact;
    chunk({ role: "assistant", content: "Saved the dashboard on your own stack." });
    chunk({}, "stop");
  } else {
    const editing = String(last.content).includes("Revise");
    chunk({ role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function", function: {
      name: editing ? "edit_dashboard" : "create_dashboard",
      arguments: JSON.stringify(editing ? { dashboard: latestArtifact, prompt: "Revise the section title" } : {
        title: "Fixture dashboard", description: "Self-hosted browser verification", prompt: "Show the fixture revenue by period",
      }),
    } }] });
    chunk({}, "tool_calls");
  }
  response.end("data: [DONE]\n\n");
});

try {
  model.listen(0, "127.0.0.1"); await once(model, "listening");
  await db.query("INSERT INTO apps (id,user_id,name,pending_prompt) VALUES ($1,$2,$3,$4)", [appId, userId, "Self-hosted verification", "Build a fixture dashboard"]);
  const modelPort = model.address().port;
  const development = process.env.SMOKE_DEV === "1";
  const runtimeEnv = { ...process.env, NODE_ENV: development ? "development" : "production", PORT: String(port), APP_ORIGIN: origin,
    DATABASE_URL: databaseUrl, DATABASE_URL_UNPOOLED: databaseUrl, LLM_BASE_URL: `http://127.0.0.1:${modelPort}/v1`, LLM_MODEL: "fixture-model", LLM_DASHBOARD_MODEL: "fixture-model",
    AUTH_PASSWORD: password, AUTH_SECRET: randomUUID(), AUTH_USER_ID: userId, AUTH_USER_EMAIL: "smoke@localhost", ENCRYPTION_KEY: "ab".repeat(32),
    SUPABASE_URL: "", ENABLE_DEMO_DATA: "", POSTHOG_KEY: "", NEXT_PUBLIC_POSTHOG_KEY: "", NEXT_TELEMETRY_DISABLED: "1",
  };
  let command = process.execPath;
  let commandArgs = ["node_modules/next/dist/bin/next", development ? "dev" : "start", "-H", "127.0.0.1", "-p", String(port)];
  if (process.env.SMOKE_IMAGE) {
    if (process.platform !== "linux") throw new Error("Image smoke checks currently require Linux host networking");
    containerName = `opendashboards-smoke-${randomUUID()}`;
    command = "docker";
    commandArgs = ["run", "--rm", "--name", containerName, "--network", "host",
      ...Object.keys(runtimeEnv).filter((name) => /^(NODE_ENV|PORT|APP_ORIGIN|DATABASE_URL|DATABASE_URL_UNPOOLED|LLM_.*|AUTH_.*|ENCRYPTION_KEY|SUPABASE_URL|ENABLE_DEMO_DATA|POSTHOG_KEY|NEXT_PUBLIC_POSTHOG_KEY|NEXT_TELEMETRY_DISABLED)$/.test(name)).flatMap((name) => ["--env", name]),
      process.env.SMOKE_IMAGE, "sh", "-c", `node scripts/db-migrate.mjs && exec node node_modules/next/dist/bin/next start -H 127.0.0.1 -p ${port}`];
  }
  appServer = spawn(command, commandArgs, { env: runtimeEnv, stdio: ["ignore", "pipe", "pipe"] });
  appServer.stdout.on("data", (chunk) => { serverLog += chunk; });
  appServer.stderr.on("data", (chunk) => { serverLog += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (appServer.exitCode !== null) throw new Error(`App server exited before startup:\n${serverLog}`);
    try { await fetch(`${origin}/login`); ready = true; break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error(`App server did not start:\n${serverLog}`);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const external = [];
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => network.push({ path: new URL(response.url()).pathname, origin: new URL(response.url()).origin, status: response.status(), sessionSent: Boolean(response.request().headers().cookie?.includes("opendashboards_session=")) }));
  page.on("request", (request) => { if (new URL(request.url()).origin !== origin) external.push(new URL(request.url()).origin); });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { return route.abort(); }
    return route.continue();
  });
  expect((await page.request.get(`${origin}/api/artifacts/nonexistent`)).status()).toBe(401);
  await page.goto(`${origin}/apps/${appId}`);
  await expect(page.getByRole("heading", { name: "Sign in to OpenDashboards" })).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`${origin}/apps`);
  await page.goto(`${origin}/apps/${appId}`);
  await expect(page.getByText("Owned revenue", { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("300", { exact: true })).toBeVisible();
  const afterCreate = requests;
  await page.getByRole("radio", { name: "7 days", exact: true }).click();
  await expect(page.getByText("70", { exact: true })).toBeVisible();
  expect(requests).toBe(afterCreate); // Filters query locally without another model call.
  if (!(await page.getByRole("textbox", { name: "Message OpenDashboards" }).isVisible())) {
    await page.getByRole("button", { name: "Build", exact: true }).click();
  }
  await page.getByRole("textbox", { name: "Message OpenDashboards" }).fill("Revise the section title");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Owned revenue revised", { exact: true })).toBeVisible({ timeout: 90_000 });
  await page.reload();
  await expect(page.getByText("Owned revenue revised", { exact: true })).toBeVisible();
  if (!(await page.getByRole("textbox", { name: "Message OpenDashboards" }).isVisible())) {
    await page.getByRole("button", { name: "Build", exact: true }).click();
  }
  await expect(page.getByText("Revise the section title", { exact: true }).first()).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(external).toEqual([]);
  const stored = await db.query("SELECT count(*) AS count FROM chat_turns t JOIN app_threads a USING(thread_id) WHERE a.app_id=$1", [appId]);
  expect(Number(stored.rows[0].count)).toBe(2);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/self-hosted-dashboard.png", fullPage: true });
  console.log("PASS: standalone login, streamed tool calls, dashboard create/edit/reload, reactive filters without inference, local history, and zero external browser requests.");
} catch (error) {
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/self-hosted-server.log", serverLog + "\n" + JSON.stringify(network));
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) {
    const cookies = await context.cookies();
    await writeFile("test-results/self-hosted-cookie-shape.json", JSON.stringify(cookies.map(({name,domain,path,expires,httpOnly,secure,sameSite}) => ({name,domain,path,expires,httpOnly,secure,sameSite}))));
    await page.screenshot({ path: "test-results/self-hosted-failure.png", fullPage: true }).catch(() => {});
    await writeFile("test-results/self-hosted-failure.html", await page.content()).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  if (containerName) {
    const stop = spawn("docker", ["stop", "--time", "2", containerName], { stdio: "ignore" });
    await once(stop, "exit").catch(() => {});
  }
  if (appServer) { if (appServer.exitCode === null) { appServer.kill("SIGTERM"); await once(appServer, "exit").catch(() => {}); } }
  model.closeAllConnections(); await new Promise((resolve) => model.close(resolve));
  await db.query("DELETE FROM apps WHERE id=$1 AND user_id=$2", [appId, userId]);
  await db.end();
}
