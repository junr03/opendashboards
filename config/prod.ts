import type { EnvironmentSettings } from "./settings";

/** Production builds and `next start`, behind the gateway. */
export const prod: EnvironmentSettings = {
  auth: { devUser: null, publicHost: new URL(process.env.APP_ORIGIN ?? "https://localhost").host },
  appOrigin: process.env.APP_ORIGIN ?? "https://localhost",
  secrets: { allowPlaintext: false },
  network: { connectAttemptTimeoutMs: null, privateDestinations: [] },
};
