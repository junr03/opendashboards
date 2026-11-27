import "server-only";

import OpenAI from "openai";
import { config, secrets } from "@/config";

/** All model calls go directly to the operator's endpoint. */
export function createInferenceClient({ baseUrl, apiKey, timeoutMs = 300_000 }: {
  baseUrl: string; apiKey?: string; timeoutMs?: number;
}) {
  return new OpenAI({ baseURL: baseUrl, apiKey: apiKey || "local-inference", timeout: timeoutMs, maxRetries: 2 });
}

let client: OpenAI | undefined;
export function getInference(): OpenAI {
  const settings = config().inference;
  client ??= createInferenceClient({ baseUrl: settings.baseUrl, apiKey: secrets.llmApiKey(), timeoutMs: settings.timeoutMs });
  return client;
}
