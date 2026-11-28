import "server-only";

import OpenAI from "openai";
import { config, secrets } from "@/config";
import { measuredInferenceFetch } from "./inference/performance";

/** All model calls go directly to the operator's endpoint. */
export function createInferenceClient({ baseUrl, apiKey, timeoutMs = 300_000, performanceMetrics = false }: {
  baseUrl: string; apiKey?: string; timeoutMs?: number; performanceMetrics?: boolean;
}) {
  return new OpenAI({ baseURL: baseUrl, apiKey: apiKey || "local-inference", timeout: timeoutMs, maxRetries: 2,
    ...(performanceMetrics ? { fetch: measuredInferenceFetch() } : {}),
  });
}

let client: OpenAI | undefined;
export function getInference(): OpenAI {
  const settings = config().inference;
  client ??= createInferenceClient({ baseUrl: settings.baseUrl, apiKey: secrets.llmApiKey(), timeoutMs: settings.timeoutMs, performanceMetrics: settings.performanceMetrics });
  return client;
}
