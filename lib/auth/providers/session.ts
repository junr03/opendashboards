import { createHash, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import type { AuthProvider, AuthUser } from "../provider";

export const SESSION_COOKIE = "opendashboards_session";
const issuer = "opendashboards";

export const operatorUser = (): AuthUser => ({
  id: process.env.AUTH_USER_ID ?? "dev-user", email: process.env.AUTH_USER_EMAIL ?? "operator@localhost",
});

export function passwordMatches(input: string, password: string): boolean {
  const hash = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(hash(input), hash(password));
}

export async function createSession(secret: string, user: AuthUser): Promise<string> {
  return new SignJWT({ email: user.email }).setProtectedHeader({ alg: "HS256" }).setIssuer(issuer)
    .setAudience("opendashboards-session").setSubject(user.id).setIssuedAt().setExpirationTime("12h")
    .sign(new TextEncoder().encode(secret));
}

/** One operator account; sessions are local signed cookies with no identity service dependency. */
export function sessionProvider(secret: string, user: AuthUser): AuthProvider {
  if (secret.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters");
  return {
    async authenticate(headers) {
      const token = headers.get("cookie")?.split(";").map((part) => part.trim())
        .find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
      if (!token) return { ok: false, reason: "signed_out" };
      try {
        const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
          issuer, audience: "opendashboards-session", algorithms: ["HS256"],
        });
        if (payload.sub !== user.id || payload.email !== user.email) return { ok: false, reason: "invalid" };
        return { ok: true, user };
      } catch { return { ok: false, reason: "invalid" }; }
    },
  };
}
