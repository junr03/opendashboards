import "server-only";

import { buildMessage, parseMessage } from "@openuidev/lang-core";
import { config } from "@/config";
import { getDb } from "@/lib/db";
import { getInference } from "@/lib/inference";
import { ToolError, toolsFor, type Tool, type ToolContext } from "@/lib/tools";
import { createArtifactStore, type Artifact } from "./artifacts";
import { DashboardError } from "./errors";
import { createDashboardGenerator } from "./generation";
import { runScript } from "./sandbox";
import { createDashboardService, type DashboardService } from "./service";

export { DashboardError } from "./errors";
let service: DashboardService | undefined;
export function getDashboardService(): DashboardService {
  service ??= createDashboardService({ db: getDb() });
  return service;
}
export const getArtifacts = () => createArtifactStore(getDb());

function responseFor(artifact: Artifact, title?: string): string {
  return buildMessage({ content: "Dashboard ready.", attributes: {
    artifact_id: artifact.id, version: String(artifact.version), ...(title ? { name: title } : {}),
  }, end: true });
}

/** Generation, storage and query execution are all owned by this deployment. */
export function getDashboards() {
  const tools = toolsFor("dashboard");
  const generate = (prompt: string, signal: AbortSignal, previous?: import("./artifacts").DashboardDocument) =>
    createDashboardGenerator({ client: getInference(), model: config().inference.dashboardModel, tools })(prompt, signal, previous);
  const store = getArtifacts();
  return {
    async create({ title, prompt }: { title: string; prompt: string }, context: ToolContext, { signal }: { signal: AbortSignal }) {
      const document = await generate(prompt, signal);
      signal.throwIfAborted();
      const artifact = await store.create(context.userId, context.appId, title, document);
      return responseFor(artifact, title);
    },
    async edit({ id, prompt }: { id: string; prompt: string }, context: ToolContext, { signal }: { signal: AbortSignal }) {
      const previous = await store.read(context.userId, context.appId, id);
      if (!previous) throw new DashboardError("Dashboard not found", "not_found", 404);
      const document = await generate(prompt, signal, previous);
      signal.throwIfAborted();
      return responseFor(await store.update(context.userId, context.appId, id, previous.version, document));
    },
    interpreter: {
      async execute(input: { id: string; version?: string; name: string; arguments?: Record<string, unknown> }, context: ToolContext,
        options: { signal: AbortSignal; timeoutMs?: number }) {
        const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 120_000)]);
        const version = input.version === undefined ? undefined : Number(input.version);
        if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) throw new DashboardError("Invalid version", "invalid_version");
        const artifact = await store.read(context.userId, context.appId, input.id, version);
        if (!artifact) throw new DashboardError("Dashboard content not found. Legacy Cloud dashboards must be imported first.", "not_found", 404);
        const run = Object.fromEntries(tools.map((tool) => [tool.name, (args: Record<string, unknown>) => asDataTool(tool).execute(args, context, { signal })]));
        if (Object.hasOwn(run, input.name)) return run[input.name](input.arguments ?? {});
        if (!Object.hasOwn(artifact.scripts, input.name)) throw new DashboardError("Unknown dashboard query", "tool_not_found", 404);
        return runScript(artifact.scripts[input.name], input.arguments ?? {}, run, { signal });
      },
    },
  };
}

export async function readDashboard(userId: string, appId: string, artifactId: string): Promise<
  { ok: true; title: string; description: string | null; program: string; scripts: Record<string, string> } |
  { ok: false; reason: "not_found" }
> {
  const dashboard = (await getDashboardService().list(userId, appId)).find((row) => row.artifactId === artifactId);
  const artifact = dashboard && await getArtifacts().read(userId, appId, artifactId);
  if (!artifact || !dashboard) return { ok: false, reason: "not_found" };
  return { ok: true, title: dashboard.title, description: dashboard.description, program: artifact.program, scripts: artifact.scripts };
}

export type DeleteResult = { ok: true } | { ok: false; reason: "not_found" };
export async function deleteDashboard(userId: string, appId: string, artifactId: string): Promise<DeleteResult> {
  return await getDashboardService().remove(userId, appId, artifactId) ? { ok: true } : { ok: false, reason: "not_found" };
}

/** A source's execution remains scoped to the server's authenticated context. */
export function asDataTool(tool: Tool) {
  return {
    description: tool.description, parameters: tool.parameters, output: tool.output,
    async execute(args: unknown, context: ToolContext, { signal }: { signal: AbortSignal }) {
      try {
        return await tool.run(args, context, { signal, caller: "dashboard" });
      } catch (error) {
        if (error instanceof ToolError) {
          if (error.code === "reauth_required") context.onSignInLost?.();
          throw new DashboardError(error.message, error.code, 400);
        }
        throw error;
      }
    },
  };
}

export function artifactOf(response: string): { id: string; title?: string } | null {
  const { attributes } = parseMessage(response);
  const id = typeof attributes.artifact_id === "string" ? attributes.artifact_id : null;
  return id ? { id, title: typeof attributes.name === "string" ? attributes.name : undefined } : null;
}
