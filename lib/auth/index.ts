import { config, secrets, type Environment } from "@/config";

import type { AuthProvider, AuthUser } from "./provider";
import { devProvider } from "./providers/dev";
import { supabaseProvider } from "./providers/supabase";
import { operatorUser, sessionProvider } from "./providers/session";

/**
 * Picks the provider that decides who requests are for. Framework-free so both
 * `proxy.ts` and `requireUser()` use the exact same check, and so it can be
 * unit tested.
 */

export type { AuthOutcome, AuthProvider, AuthUser } from "./provider";

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

/** What auth needs from the configuration: the environment, its dev user and Supabase. */
export type AuthSettings = {
  environment: Environment;
  devUser: AuthUser | null;
  supabaseUrl: string | undefined;
  authSecret?: string;
};

const currentAuthSettings = (): AuthSettings => {
  const { env, auth } = config();
  return {
    environment: env,
    devUser: auth.devUser,
    supabaseUrl: secrets.supabaseUrl(),
    authSecret: secrets.authSecret(),
  };
};

/**
 * Fails closed: outside local there is never a dev user, so Supabase
 * or standalone sessions are required. Locally, configuring either provider
 * turns the check on.
 *
 * Startup validation already refuses these cases; this refuses them again in
 * case a request somehow gets this far.
 */
export function getAuthProvider(settings: AuthSettings = currentAuthSettings()): AuthProvider {
  if (settings.environment !== "local" && settings.devUser !== null) {
    throw new AuthConfigError(`${settings.environment} can't have a dev user; only local may skip the gateway`);
  }
  if (settings.supabaseUrl) return supabaseProvider(settings.supabaseUrl);
  if (settings.authSecret) return sessionProvider(settings.authSecret, operatorUser());
  if (settings.devUser === null) throw new AuthConfigError("Configure AUTH_SECRET and AUTH_PASSWORD, or SUPABASE_URL, outside local");
  if (!settings.devUser.id) throw new AuthConfigError("auth.devUser.id is empty");
  if (!settings.devUser.email) throw new AuthConfigError("auth.devUser.email is empty");
  return devProvider(settings.devUser);
}
