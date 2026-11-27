import { NextResponse } from "next/server";
import { config, secrets } from "@/config";
import { createSession, operatorUser, passwordMatches, SESSION_COOKIE } from "@/lib/auth/providers/session";
import { assertSameOrigin, HttpError, readText } from "@/lib/http";

// Bounds password guessing per process. Long operator passwords remain mandatory.
const attempts = new Map<string, { count: number; reset: number }>();
export async function POST(request: Request) {
  try { assertSameOrigin(request); }
  catch (error) { if (error instanceof HttpError) return new Response(error.message, { status: error.status }); throw error; }
  const expectedPassword = secrets.authPassword();
  const sessionSecret = secrets.authSecret();
  if (!expectedPassword || !sessionSecret) return new Response("Standalone login is not configured", { status: 503 });
  const now = Date.now();
  // One shared bucket avoids trusting client-supplied forwarded-IP headers.
  const bucket = attempts.get("login") ?? { count: 0, reset: now + 60_000 };
  if (now > bucket.reset) { bucket.count = 0; bucket.reset = now + 60_000; }
  attempts.set("login", bucket);
  if (++bucket.count > 20) return new Response("Too many sign-in attempts. Retry in a minute.", { status: 429, headers: { "Retry-After": "60" } });
  let body: string;
  try { body = await readText(request, 4096); }
  catch (error) { if (error instanceof HttpError) return new Response(error.message, { status: error.status }); throw error; }
  const password = new URLSearchParams(body).get("password") ?? "";
  if (!passwordMatches(password, expectedPassword)) return new Response("Incorrect password. Return to the sign-in page and retry.", { status: 401 });
  const response = NextResponse.redirect(new URL("/apps", config().appOrigin), 303);
  response.cookies.set(SESSION_COOKIE, await createSession(sessionSecret, operatorUser()), {
    httpOnly: true, sameSite: "strict", secure: new URL(config().appOrigin).protocol === "https:", path: "/", maxAge: 12 * 60 * 60,
  });
  return response;
}
