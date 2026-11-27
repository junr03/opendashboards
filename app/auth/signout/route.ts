import { NextResponse } from "next/server";
import { config } from "@/config";
import { SESSION_COOKIE } from "@/lib/auth/providers/session";
import { assertSameOrigin, HttpError } from "@/lib/http";

export async function POST(request: Request) {
  try { assertSameOrigin(request); }
  catch (error) { if (error instanceof HttpError) return new Response(error.message, { status: error.status }); throw error; }
  const response = NextResponse.redirect(new URL("/login", config().appOrigin), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
