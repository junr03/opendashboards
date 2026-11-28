"use client";

import type { InferencePerformance } from "@/lib/inference/measurements";
import { useThreadList } from "@openuidev/react-ui";

const seconds = (ms: number | null) => ms === null ? "—" : `${(ms / 1000).toFixed(2)}s`;

/** Last measured turn only; server logs retain the data for session-level analysis. */
export function InferencePerformancePanel({ report }: { report: InferencePerformance & { browser_ms: number; thread_id: string } }) {
  const selected = useThreadList(state => state.selectedThreadId);
  if (selected !== report.thread_id) return null;
  return (
    <details className="shrink-0 border-t px-3 py-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer">Performance · {seconds(report.browser_ms)} · {report.calls.length} model requests</summary>
      <dl className="my-2 grid grid-cols-2 gap-1">
        <dt>Browser wait</dt><dd>{seconds(report.browser_ms)}</dd>
        <dt>Server turn</dt><dd>{seconds(report.duration_ms)}</dd>
        <dt>Inference wait</dt><dd>{seconds(report.inference_ms)}</dd>
        <dt>Other server work</dt><dd>{seconds(report.other_ms)}</dd>
        <dt>Outcome</dt><dd>{report.outcome}</dd>
      </dl>
      <ul aria-label="Model requests" className="max-h-60 overflow-auto">
        {report.calls.map(call => <li key={call.id} className="border-t py-2">
          <p className="mb-1 font-medium">{call.phase} · {call.model} · {call.outcome}</p>
          <dl className="grid grid-cols-3 gap-2">
            {[
              ["Request", seconds(call.duration_ms)], ["First token", seconds(call.ttft_ms)],
              ["First output", seconds(call.first_output_ms)], ["Input/output tokens", `${call.prompt_tokens ?? "—"} / ${call.completion_tokens ?? "—"}`],
              ["Effective tok/s", call.tokens_per_second?.toFixed(1) ?? "—"],
            ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="text-foreground">{value}</dd></div>)}
          </dl>
        </li>)}
      </ul>
      <p className="mt-2">Effective rate includes loading and prompt processing. First token can be thinking; first output is text or tool activity. Buffered calls and missing counts show —.</p>
      <p className="mt-1">Trace: <code>{report.trace_id}</code></p>
    </details>
  );
}
