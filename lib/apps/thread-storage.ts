import { openAIMessageFormat, type ChatStorage, type Thread } from "@openuidev/react-headless";

/** ChatProvider's storage backed entirely by this app's authenticated routes. */
export function localThreadStorage(appId: string, { fetch: fetchImpl = fetch }: { fetch?: typeof fetch } = {}): ChatStorage {
  const base = `/api/apps/${encodeURIComponent(appId)}/threads`;
  const threadUrl = (id: string) => `${base}/${encodeURIComponent(id)}`;
  async function call<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetchImpl(url, { ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined, cache: "no-store" });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string | { message?: string } } | null;
      const message = typeof body?.error === "string" ? body.error : body?.error?.message;
      throw new Error(message ?? `Request failed (${response.status})`);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }
  return { thread: {
    listThreads: (cursor) => call(`${base}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
    createThread: (message) => call<Thread>(base, { method: "POST", body: JSON.stringify({
      title: (typeof message.content === "string" ? message.content : "New chat").slice(0, 200),
    }) }),
    async getMessages(id) {
      const result = await call<{ messages: unknown[] }>(threadUrl(id));
      return openAIMessageFormat.fromApi(result.messages);
    },
    async updateThread(thread) {
      await call(threadUrl(thread.id), { method: "PATCH", body: JSON.stringify({ title: thread.title }) });
      return thread;
    },
    deleteThread: (id) => call<void>(threadUrl(id), { method: "DELETE" }),
  } };
}
