// One-time, read-only archive of legacy Cloud content referenced by our database.
// Never called by the app. Raw exports contain user content: keep .backups private.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });
if (!process.env.DATABASE_URL || !process.env.THESYS_API_KEY) throw new Error("DATABASE_URL and legacy THESYS_API_KEY are required for this one-time export");
const origin = process.env.LEGACY_OPENUI_URL ?? "https://api.thesys.dev";
const output = resolve(process.argv[2] ?? `.backups/openui-${Date.now()}`);
await mkdir(output, { recursive: true, mode: 0o700 });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const manifest = { exportedAt: new Date().toISOString(), artifacts: [], conversations: [], failures: [] };
const tokens = new Map();
async function request(path, userId) {
  if (!tokens.has(userId)) {
    const result = await fetch(`${origin}/v1/frontend-tokens`, {
      method: "POST", headers: { Authorization: `Bearer ${process.env.THESYS_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }), signal: AbortSignal.timeout(30000),
    });
    if (!result.ok) throw new Error(`Token request failed (${result.status})`);
    const { token } = await result.json();
    if (typeof token !== "string" || !token) throw new Error("Invalid frontend token response");
    tokens.set(userId, token);
  }
  const result = await fetch(`${origin}${path}`, { headers: { "x-thesys-frontend-token": tokens.get(userId) }, signal: AbortSignal.timeout(30000) });
  if (!result.ok) throw new Error(`Legacy export failed (${result.status})`);
  return result.json();
}
async function save(name, value) { await writeFile(resolve(output, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" }); }
try {
  const { rows: dashboards } = await db.query("SELECT id, artifact_id, app_id, user_id, title, description FROM dashboards WHERE artifact_id NOT IN (SELECT id FROM dashboard_artifacts)");
  for (const dashboard of dashboards) {
    try {
      const artifact = await request(`/v1/artifacts/${encodeURIComponent(dashboard.artifact_id)}`, dashboard.user_id);
      const file = `artifact-${dashboard.id}.json`;
      await save(file, { metadata: dashboard, artifact });
      manifest.artifacts.push({ id: dashboard.artifact_id, file });
    } catch (error) { manifest.failures.push({ id: dashboard.artifact_id, message: error.message }); }
  }
  const { rows: conversations } = await db.query("SELECT * FROM app_threads WHERE thread_id NOT IN (SELECT thread_id FROM chat_turns)");
  for (const [index, thread] of conversations.entries()) {
    try {
      const items = [];
      let after;
      for (let page = 0; page < 10000; page++) {
        const query = new URLSearchParams({ order: "asc", limit: "100", ...(after ? { after } : {}) });
        const result = await request(`/v1/conversations/${encodeURIComponent(thread.thread_id)}/items?${query}`, thread.user_id);
        if (!Array.isArray(result.data)) throw new Error("Invalid conversation response");
        items.push(...result.data);
        if (!result.has_more) break;
        if (!result.last_id || result.last_id === after || page === 9999) throw new Error("Invalid or excessive pagination; export incomplete");
        after = result.last_id;
      }
      const file = `conversation-${index}.json`;
      await save(file, { metadata: thread, items });
      manifest.conversations.push({ id: thread.thread_id, file });
    } catch (error) { manifest.failures.push({ id: thread.thread_id, message: error.message }); }
  }
  await save("manifest.json", manifest);
  console.log(`Exported ${manifest.artifacts.length} dashboards and ${manifest.conversations.length} conversations to ${output}. Failures: ${manifest.failures.length}. No database or Cloud records changed.`);
  if (manifest.failures.length) process.exitCode = 1;
} finally { await db.end(); }
