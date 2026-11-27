import "server-only";

import { waitUntil } from "@vercel/functions";
import { PostHog } from "posthog-node";

let client: PostHog | undefined;

/**
 * Records a product event for a user, only on Vercel. Properties are ids,
 * counts and fixed labels: never prompts, queries, names or credentials.
 */
export function track(userId: string, event: string, properties: Record<string, unknown> = {}): void {
  const environment = process.env.VERCEL_ENV;
  const key = process.env.POSTHOG_KEY;
  const host = process.env.POSTHOG_HOST;
  if (!key || !host) return;
  client ??= new PostHog(key, { host });
  // Sent before the function is frozen; a failure never reaches the user.
  waitUntil(
    client
      .captureImmediate({
        distinctId: userId,
        event: `opendashboards_${event}`,
        properties: { app: "opendashboards", environment, ...properties },
      })
      .catch(() => {}),
  );
}
