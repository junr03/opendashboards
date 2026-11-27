// Imports an archived conversation before any new local turns have been written.
// Does not contact Cloud or alter the source archive. Run once per conversation JSON.
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import pg from "pg";
import { openAIConversationMessageFormat, openAIMessageFormat } from "@openuidev/react-headless";

config({ path: ".env.local", quiet: true });
if (!process.env.DATABASE_URL || !process.argv[2]) throw new Error("Usage: node scripts/import-openui-history.mjs .backups/export/conversation-N.json (DATABASE_URL required)");
const archive = JSON.parse(await readFile(process.argv[2], "utf8"));
const thread = archive.metadata;
if (!thread || !Array.isArray(archive.items) || ![thread.thread_id, thread.app_id, thread.user_id].every((id) => typeof id === "string" && id.length > 0)) throw new Error("Invalid conversation archive");
const supported = new Set(["message", "function_call", "function_call_output"]);
if (archive.items.some((item) => !supported.has(item.type))) throw new Error("Archive contains unsupported item types; refusing an incomplete import");
const items = archive.items.map((item) => {
  if (item.type === "message") return { ...item, content: Array.isArray(item.content) ? item.content : [{ type: item.role === "assistant" ? "output_text" : "input_text", text: item.content ?? "" }] };
  if (item.type === "function_call") {
    if (typeof item.call_id !== "string" || typeof item.name !== "string") throw new Error("Invalid function call in archive");
    return { ...item, arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}) };
  }
  if (typeof item.call_id !== "string" || item.output === undefined) throw new Error("Invalid function result in archive");
  return item;
});
const messages = openAIMessageFormat.toApi(openAIConversationMessageFormat.fromApi(items));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  const owned = await db.query("SELECT thread_id FROM app_threads WHERE thread_id=$1 AND app_id=$2 AND user_id=$3 FOR UPDATE", [thread.thread_id, thread.app_id, thread.user_id]);
  if (owned.rowCount !== 1) throw new Error("Archive does not match an existing owned conversation");
  const existing = await db.query("SELECT run_id FROM chat_turns WHERE thread_id=$1", [thread.thread_id]);
  if (existing.rows.some((row) => row.run_id !== "legacy-cloud-import")) throw new Error("Conversation already has local turns; merge history explicitly to preserve ordering");
  await db.query("INSERT INTO chat_turns (thread_id,run_id,messages) VALUES ($1,'legacy-cloud-import',$2::jsonb) ON CONFLICT DO NOTHING", [thread.thread_id, JSON.stringify(messages)]);
  await db.query("COMMIT");
  console.log(`Imported ${messages.length} messages. Retrying the same archive is idempotent.`);
} catch (error) { await db.query("ROLLBACK"); throw error; }
finally { await db.end(); }
