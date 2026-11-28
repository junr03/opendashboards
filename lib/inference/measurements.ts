/** Numeric observations only: no messages, tool arguments, URLs or credentials. */
export type InferenceCall = {
  id: string;
  phase: "chat" | "dashboard";
  model: string;
  streaming: boolean;
  outcome: "completed" | "failed" | "cancelled";
  status: number | null;
  duration_ms: number;
  ttft_ms: number | null;
  first_output_ms: number | null;
  prompt_tokens: number | null;
  cached_prompt_tokens: number | null;
  completion_tokens: number | null;
  tokens_per_second: number | null;
};

export type InferencePerformance = {
  trace_id: string;
  outcome: InferenceCall["outcome"];
  duration_ms: number;
  inference_ms: number;
  other_ms: number;
  calls: InferenceCall[];
};

export const PERFORMANCE_EVENT = "inference_performance";
