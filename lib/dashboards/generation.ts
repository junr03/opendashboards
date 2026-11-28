import { createParser, generateSystemPrompt, type LibrarySpec, type ToolSpec } from "@openuidev/lang-core";
import type OpenAI from "openai";
import { z } from "zod";

import type { Tool } from "@/lib/tools";
import type { DashboardDocument } from "./artifacts";
import { DashboardError } from "./errors";
import { checkScript } from "./sandbox";
import spec from "./generated/dashboard.spec.json";
import promptOptions from "./generated/dashboard.prompt.json";
import { withInferencePhase } from "@/lib/inference/performance";

const documentSchema = z.object({
  program: z.string().min(1).max(120_000),
  scripts: z.record(z.string().regex(/^script_[A-Za-z0-9_]{1,80}$/), z.string().min(1).max(32_000))
    .refine((scripts) => Object.keys(scripts).length <= 10, "At most 10 scripts"),
}).strict();
const library = spec as unknown as LibrarySpec;

export async function validateDocument(input: unknown, toolNames: string[]): Promise<DashboardDocument> {
  const document = documentSchema.parse(input);
  const parser = createParser(library.schema ?? {}, library.root);
  const parsed = parser.parse(document.program);
  const errors = parsed.meta.errors.filter((error) => error.severity !== "warning");
  if ((!parsed.root && !parsed.rootExpression) || parsed.meta.incomplete || parsed.meta.unresolved.length || errors.length) {
    throw new DashboardError(`Invalid OpenUI program: ${errors.map((e) => e.message).join("; ") || parsed.meta.unresolved.join(", ") || "missing or incomplete root"}`, "invalid_program");
  }
  if (parsed.mutationStatements.length) throw new DashboardError("Dashboards may only read data", "invalid_program");
  const allowed = new Set([...toolNames, ...Object.keys(document.scripts)]);
  for (const query of parsed.queryStatements) {
    if (query.toolAST?.k !== "Str" || !allowed.has(query.toolAST.v)) {
      throw new DashboardError("Every Query must name a registered tool or one of this document's scripts", "invalid_program");
    }
  }
  for (const source of Object.values(document.scripts)) await checkScript(source);
  return document;
}

/** A bounded local repair loop; a failed generation never overwrites a working version. */
export function createDashboardGenerator({ client, model, tools }: { client: OpenAI; model: string; tools: Tool[] }) {
  const toolSpecs: ToolSpec[] = tools.map((tool) => ({ name: tool.name, description: tool.description,
    inputSchema: tool.parameters, outputSchema: tool.output && typeof tool.output === "object" ? { example: tool.output } : {},
    annotations: { readOnlyHint: true } }));
  const system = generateSystemPrompt({ library, promptOptions: { ...promptOptions, tools: toolSpecs } }) + `

RESPONSE CONTRACT (overrides plain-text output instructions above):
Return one JSON object, without Markdown fences: {"program":"OpenUI Lang source", "scripts":{}}.
The program must have Dashboard as its root and use only the registered component library.
All live numbers come from Query calls to the listed tools. Never invent data. Use empty defaults.
If calculations or query orchestration need JavaScript, put named function BODIES in scripts.
Each script name starts with script_. A script receives args and tools; return a JSON value.
Example body: const data = tools.postgres_query({connection: args.connection, sql: args.sql}); return {rows: data.rows};
Tools are synchronous INSIDE scripts (the interpreter suspends for I/O). Do not use async/await or promises.
Scripts have standard JavaScript, no Node, network, imports, timers, or files. Call only tools listed above.
Call a script from the program with Query("script_name", {arguments}, {empty defaults}).
Never put scripts in the OpenUI program. For edits return the complete program and scripts, preserving unchanged sections.
`;
  return async function generate(prompt: string, signal: AbortSignal, previous?: DashboardDocument): Promise<DashboardDocument> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [{ role: "system", content: system }, {
      role: "user", content: previous ? `Current document:\n${JSON.stringify(previous)}\n\nRequested edit:\n${prompt}` : prompt,
    }];
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      const completion = await withInferencePhase("dashboard", () => client.chat.completions.create({ model, messages, max_tokens: 16_384, stream: false }, { signal }));
      const content = completion.choices[0]?.message.content ?? "";
      try {
        if (completion.choices[0]?.finish_reason === "length") throw new Error("Output truncated; produce a smaller complete dashboard");
        const json = content.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
        return await validateDocument(JSON.parse(json) as unknown, tools.map((tool) => tool.name));
      } catch (error) {
        signal.throwIfAborted();
        if (attempt === 2) throw new DashboardError("The model could not produce a valid dashboard after three attempts. The previous version is unchanged.", "generation_failed", 422);
        messages.push({ role: "assistant", content }, { role: "user", content: `Repair the document. ${error instanceof Error ? error.message.slice(0, 4000) : "Invalid JSON"}. Return only the complete JSON object.` });
      }
    }
    throw new Error("Unreachable generation state");
  };
}
