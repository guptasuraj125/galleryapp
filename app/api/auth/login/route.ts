import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSession,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
  verifyPassword,
} from "@/src/lib/auth";
import { connectToDatabase } from "@/src/lib/mongodb";
import { User } from "@/src/models/User";
import { consumeRateLimit } from "@/src/lib/rate-limit";
import { errorJson, logApiError } from "@/src/lib/api-response";
import { toMongoConnectionError } from "@/src/lib/mongodb-errors";

export const runtime = "nodejs";

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(8).max(72).refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "Password must be at least 8 characters and no more than 72 bytes.",
  ),
});

async function login(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const ipAddress =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const ipLimit = await consumeRateLimit(`login-ip:${ipAddress}`, 30, 15 * 60 * 1000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    throw error;
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter valid login details." }, { status: 400 });
  }

  const identifierLimit = await consumeRateLimit(
    `login-identifier:${parsed.data.identifier.toLowerCase()}`,
    10,
    15 * 60 * 1000,
  );
  if (!identifierLimit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(identifierLimit.retryAfterSeconds) } },
    );
  }

  await connectToDatabase();
  const identifier = parsed.data.identifier.toLowerCase();
  const user = await User.findOne({
    $or: [{ email: identifier }, { username: identifier }],
    isActive: true,
  }).select("+passwordHash");

  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return NextResponse.json({ error: "Invalid login details." }, { status: 401 });
  }

  const token = await createSession(user.id);
  const response = NextResponse.json({ authenticated: true });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}

export async function POST(request: Request) {
  try {
    return await login(request);
  } catch (error) {
    logApiError("auth-login", error);
    const databaseError = toMongoConnectionError(error);
    return errorJson(
      databaseError?.userMessage ?? "Sign-in is temporarily unavailable. Check the server configuration and try again.",
      503,
    );
  }
}
