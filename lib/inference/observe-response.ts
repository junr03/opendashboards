type End = "completed" | "failed" | "cancelled";
const MAX_OBSERVATION_BYTES = 1024 * 1024;

/** Observe JSON/SSE while forwarding the original bytes with backpressure. */
export function observeResponse(
  response: Response,
  onValue: (value: unknown) => void,
  onEnd: (end: End) => void,
  signal?: AbortSignal | null,
): Response {
  if (!response.body) { onEnd("completed"); return response; }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const streaming = response.headers.get("content-type")?.includes("text/event-stream");
  let buffer = "";
  let oversized = false;
  let ended = false;
  const end = (outcome: End) => { if (!ended) { ended = true; onEnd(outcome); } };
  const value = (text: string) => {
    if (text.trim() === "[DONE]") return;
    try { onValue(JSON.parse(text)); } catch { /* Observation never changes the response. */ }
  };
  const inspect = (bytes?: Uint8Array) => {
    buffer += decoder.decode(bytes, { stream: !!bytes });
    if (streaming) {
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        if (!oversized) value(frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n"));
        oversized = false;
      }
    }
    if (buffer.length > MAX_OBSERVATION_BYTES) { buffer = ""; oversized = true; }
    if (!bytes && !oversized && buffer.trim()) value(streaming ? buffer.replace(/^data:\s*/, "") : buffer);
  };
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { inspect(); end("completed"); controller.close(); return; }
        inspect(value);
        controller.enqueue(value);
      } catch (error) {
        end(signal?.aborted ? "cancelled" : "failed");
        controller.error(error);
      }
    },
    async cancel(reason) { end("cancelled"); await reader.cancel(reason); },
  }), { status: response.status, statusText: response.statusText, headers: response.headers });
}
