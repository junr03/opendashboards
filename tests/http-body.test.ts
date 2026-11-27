import { describe, expect, it } from "vitest";
import { readJson, readText } from "@/lib/http";

describe("bounded HTTP request bodies", () => {
  function request(body: ReadableStream<Uint8Array>) {
    const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half", headers: { "Content-Type": "application/json" } };
    return new Request("http://localhost/auth/login", init);
  }

  it("decodes multibyte text split across network chunks", async () => {
    const bytes = new TextEncoder().encode('{"text":"€"}');
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    expect(await readJson(request(stream), { maxBytes: 100 })).toEqual({ text: "€" });
  });

  it("cancels an oversized chunked body instead of buffering it without a bound", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(512)); },
      cancel() { cancelled = true; },
    });
    await expect(readText(request(stream), 128)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });
});
