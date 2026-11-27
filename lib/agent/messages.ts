import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { z } from "zod";

import { threadIdSchema } from "@/lib/apps/schemas";

/**
 * What the Build chat may send: the thread and its history in Chat
 * Completions shape (Agent Interface's `openAIMessageFormat`). Text only; no
 * system messages; tool results only answering a tool call just before them.
 * A call left without a result, by a turn the user stopped, gets one saying so.
 */

const MAX_MESSAGES = 200;
const MAX_TEXT = 200_000;

const text = z.string().max(MAX_TEXT);
const textParts = z
  .array(z.object({ type: z.literal("text"), text }).strip())
  .max(20);

const userMessage = z
  .object({ role: z.literal("user"), content: z.union([text.min(1), textParts.min(1)]) })
  .strip();

const toolCall = z
  .object({
    id: z.string().min(1).max(200),
    type: z.literal("function"),
    function: z.object({ name: z.string().min(1).max(100), arguments: text }).strip(),
  })
  .strip();

const assistantMessage = z
  .object({
    role: z.literal("assistant"),
    content: z.union([text, textParts]).nullish(),
    tool_calls: z.array(toolCall).max(50).optional(),
  })
  .strip();

const toolMessage = z
  .object({ role: z.literal("tool"), tool_call_id: z.string().min(1).max(200), content: z.union([text, textParts]) })
  .strip();

const message = z.discriminatedUnion("role", [userMessage, assistantMessage, toolMessage]);

/** The AG-UI `context` entry naming the dashboard the user is looking at; its value is the dashboard's id. */
export const VIEWING_DASHBOARD = "The dashboard the user is looking at";

const contextEntry = z.object({ description: z.string().max(200), value: z.string().max(500) }).strip();

export const chatBodySchema = z
  .object({
    threadId: threadIdSchema,
    runId: z.string().min(1).max(128).optional(),
    context: z.array(contextEntry).max(10).optional(),
    messages: z
      .array(message)
      .min(1)
      .max(MAX_MESSAGES)
      .refine((messages) => messages.at(-1)?.role === "user", "The last message must be the user's.")
      .refine(toolResultsAnswerCalls, "Tool results must follow the call they answer.")
      .transform(answerStoppedCalls),
  })
  .loose();

export type ChatBody = {
  threadId: string;
  messages: ChatCompletionMessageParam[];
  context?: { description: string; value: string }[];
};

type Message = z.infer<typeof message>;

/** Every tool result answers a call in the assistant message just before it, once. */
function toolResultsAnswerCalls(messages: Message[]): boolean {
  let open = new Set<string>();
  for (const m of messages) {
    if (m.role === "tool") {
      if (!open.delete(m.tool_call_id)) return false;
      continue;
    }
    open = new Set(m.role === "assistant" ? (m.tool_calls ?? []).map((call) => call.id) : []);
  }
  return true;
}

/** A stopped call's result, in the agent tools' error shape. */
const STOPPED = JSON.stringify({ error: { message: "Stopped by the user before it finished." } });

/**
 * Stopping a turn mid tool call leaves the call without a result, which the
 * model API rejects, so every later message would fail. Each gets an error
 * result instead: the model knows it didn't finish, and the chat carries on.
 * Applied to the history a turn is sent with, and to a stopped turn before it's saved.
 */
export function answerStoppedCalls(messages: ChatCompletionMessageParam[]): ChatCompletionMessageParam[] {
  const answered = new Set(messages.flatMap((m) => (m.role === "tool" ? [m.tool_call_id] : [])));
  return messages.flatMap((m): ChatCompletionMessageParam[] => {
    if (m.role !== "assistant") return [m];
    const stopped = (m.tool_calls ?? []).filter((call) => !answered.has(call.id));
    if (stopped.length === 0) return [m];
    // Stopped while the model was still writing it, a call's arguments are cut-off JSON, which Gateway fails on.
    const calls = m.tool_calls?.map((call) =>
      stopped.includes(call) && call.type === "function" && !parses(call.function.arguments)
        ? { ...call, function: { ...call.function, arguments: "{}" } }
        : call,
    );
    return [
      { ...m, tool_calls: calls },
      ...stopped.map((call) => ({ role: "tool" as const, tool_call_id: call.id, content: STOPPED })),
    ];
  });
}

function parses(json: string): boolean {
  try {
    JSON.parse(json);
    return true;
  } catch {
    return false;
  }
}
