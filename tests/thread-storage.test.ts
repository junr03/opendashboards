import { describe, expect, it, vi } from "vitest";
import { localThreadStorage } from "@/lib/apps/thread-storage";

const APP = "11111111-1111-4111-8111-111111111111";
const created = { id: "chat_1", title: "Hello", createdAt: "2026-11-27T00:00:00.000Z" };

describe("local chat storage", () => {
  it("creates, lists, renames and deletes through the app's routes", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method === "POST") return Response.json(created);
      if (init?.method) return new Response(null, { status: 204 });
      return Response.json({ threads: [created], nextCursor: "next" });
    });
    const storage = localThreadStorage(APP, { fetch: fetchImpl }).thread;
    expect(await storage.createThread({ id: "m1", role: "user", content: "Hello" })).toEqual(created);
    expect(await storage.listThreads("a/b")).toMatchObject({ threads: [created] });
    await storage.updateThread({ ...created, title: "Renamed" });
    await storage.deleteThread(created.id);
    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [`/api/apps/${APP}/threads`, "POST"], [`/api/apps/${APP}/threads?cursor=a%2Fb`, undefined],
      [`/api/apps/${APP}/threads/chat_1`, "PATCH"], [`/api/apps/${APP}/threads/chat_1`, "DELETE"],
    ]);
  });

  it("restores tool activity and Markdown from locally stored provider messages", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ messages: [
      { role: "user", content: "Revenue?" },
      { role: "assistant", content: null, tool_calls: [{ id: "call1", type: "function", function: { name: "postgres_query", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call1", content: '{"rows":[]}' },
      { role: "assistant", content: "Done." },
    ] }));
    const messages = await localThreadStorage(APP, { fetch: fetchImpl }).thread.getMessages("chat_1");
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(messages[1]).toMatchObject({ toolCalls: [{ id: "call1" }] });
    expect(messages[2]).toMatchObject({ toolCallId: "call1" });
    expect(messages[3].content).toBe("Done.");
  });

  it("surfaces authentication and storage failures", async () => {
    const storage = localThreadStorage(APP, { fetch: async () => Response.json({ error: "Unauthorized" }, { status: 401 }) });
    await expect(storage.thread.listThreads()).rejects.toThrow("Unauthorized");
  });
});
