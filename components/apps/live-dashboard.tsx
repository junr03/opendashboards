"use client";

import { Renderer, useRendererQuery } from "@openuidev/react-lang";
import { parseMessage } from "@openuidev/lang-core";
import { library } from "@openuidev/dashboard-library";
import { LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SIGN_IN_LOST_HEADER } from "@/lib/dashboards/sign-in-lost";
import { useDashboardResponse } from "./app-workspace";
import { DashboardTitle } from "./dashboard-title";

type Program = { id: string; version: number; program: string };

export function LiveDashboard({ appId, dashboard }: {
  appId: string; dashboard: { id: string; artifactId: string; title: string; description: string | null };
}) {
  const response = useDashboardResponse(dashboard.artifactId);
  return <DashboardView id={dashboard.artifactId} response={response}>
    <DashboardTitle appId={appId} dashboard={dashboard} />
  </DashboardView>;
}

export function NewDashboard({ response }: { response?: string }) {
  return <DashboardView response={response} />;
}

/** Fetches owned content locally. Rendering and reactive Query calls use only open-source libraries. */
function DashboardView({ id, response, children }: { id?: string; response?: string; children?: React.ReactNode }) {
  const responseId = response ? parseMessage(response).attributes.artifact_id : undefined;
  const artifactId = id ?? (typeof responseId === "string" ? responseId : undefined);
  const [program, setProgram] = useState<Program | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const router = useRouter();
  const refreshed = useRef(false);
  const refreshOnce = useCallback(() => {
    if (!refreshed.current) { refreshed.current = true; router.refresh(); }
  }, [router]);

  useEffect(() => {
    if (!artifactId) return;
    const controller = new AbortController();
    let active = true;
    void fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (result) => {
        const body = await result.json();
        if (!result.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not load dashboard");
        if (active) { setProgram(body as Program); setError(null); }
      }).catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : "Could not load dashboard"); });
    return () => { active = false; controller.abort(); };
  }, [artifactId, response, retry]);

  const toolProvider = useMemo(() => ({
    async callTool({ name, arguments: args }: { name: string; arguments?: Record<string, unknown> }) {
      if (!program) throw new Error("Dashboard is loading");
      const result = await fetch("/api/interpreter", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: program.id, version: String(program.version), name, arguments: args ?? {} }),
      });
      if (result.headers.get(SIGN_IN_LOST_HEADER)) refreshOnce();
      const body = await result.json().catch(() => null) as { result?: unknown; error?: { message?: string } | string } | null;
      if (!result.ok || body?.error) {
        throw new Error(typeof body?.error === "string" ? body.error : body?.error?.message ?? `Query failed (${result.status})`);
      }
      return { content: [{ type: "text", text: JSON.stringify(body?.result ?? null) }], structuredContent: body?.result };
    },
  }), [program, refreshOnce]);

  return <div className="relative flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 overflow-y-auto bg-white">
      {children}
      {error ? <div role="alert" className="m-6 rounded-lg border border-red-200 p-4 text-sm text-red-700">
        <p>{error}</p><button className="mt-2 underline" onClick={() => { setError(null); setRetry((n) => n + 1); }}>Retry</button>
      </div> : program && program.id === artifactId ? <Renderer
        key={`${program.id}:${program.version}`} response={program.program} library={library}
        toolProvider={toolProvider} publishObservability={false}
        onError={(errors) => { if (errors.some((error) => error.source === "query")) refreshOnce(); }}
      >
        <Renderer.Content />
        <QueryStatus />
      </Renderer> : <div role="status" className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
        <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />Building your dashboard…
      </div>}
    </div>
  </div>;
}

function QueryStatus() {
  const { isLoading, errors, retry } = useRendererQuery();
  return <>
    {isLoading && <div role="status" className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
      <span className="flex items-center gap-2 rounded-full border bg-background px-3 py-2 text-xs shadow-sm">
        <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden />Loading data…
      </span>
    </div>}
    {errors.length > 0 && <div role="alert" className="m-4 rounded-lg border border-red-200 p-3 text-sm text-red-700">
      {errors.map((error, index) => <p key={index}>{error.message}</p>)}
      <button className="mt-2 underline" onClick={retry}>Retry queries</button>
    </div>}
  </>;
}
