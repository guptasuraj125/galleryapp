import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import mongoose from "mongoose";
import { createSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE } from "@/src/lib/auth";
import { connectToDatabase } from "@/src/lib/mongodb";
import { PrivateSpace } from "@/src/models/PrivateSpace";
import { SpaceMember } from "@/src/models/SpaceMember";
import { User } from "@/src/models/User";
import { hashPassword } from "@/src/lib/auth";
import { consumeRateLimit } from "@/src/lib/rate-limit";
import { toMongoConnectionError } from "@/src/lib/mongodb-errors";

export const runtime = "nodejs";

const setupSchema = z.object({
  setupToken: z.string().min(1).max(512),
  displayName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(72).refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "Password must be at least 8 characters and no more than 72 bytes.",
  ),
});

function matchesSetupToken(candidate: string, expected: string): boolean {
  const candidateHash = createHash("sha256").update(candidate).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

async function setup(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const ipAddress =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const rateLimit = await consumeRateLimit(`setup-ip:${ipAddress}`, 5, 60 * 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
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

  const parsed = setupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter valid setup details." }, { status: 400 });
  }

  const expectedToken = process.env.INITIAL_SETUP_TOKEN;
  if (!expectedToken || expectedToken.length < 32) {
    return NextResponse.json({ error: "First-time setup is not configured." }, { status: 503 });
  }
  if (!matchesSetupToken(parsed.data.setupToken, expectedToken)) {
    return NextResponse.json({ error: "Invalid setup key." }, { status: 403 });
  }

  await connectToDatabase();
  if (await User.exists({})) {
    return NextResponse.json({ error: "First-time setup has already been completed." }, { status: 409 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const email = parsed.data.email.toLowerCase();
  const spaceName = process.env.INITIAL_SPACE_NAME || "ghumi.ghumi";
  if (!/[a-z0-9]/i.test(spaceName)) {
    return NextResponse.json({ error: "Choose a space name with at least one letter or number." }, { status: 400 });
  }
  const usernamePrefix = email
    .split("@")[0]
    .replace(/[^a-z0-9_.-]/g, "")
    .slice(0, 23) || "memorykeeper";
  const username = `${usernamePrefix}_${randomBytes(4).toString("hex")}`;

  const databaseSession = await mongoose.startSession();
  let createdUserId = "";

  try {
    await databaseSession.withTransaction(async () => {
      if (await User.exists({}).session(databaseSession)) {
        throw new Error("First-time setup has already been completed.");
      }

      const [user] = await User.create(
        [{
          email,
          username,
          displayName: parsed.data.displayName,
          passwordHash,
        }],
        { session: databaseSession },
      );
      const [space] = await PrivateSpace.create(
        [{
          name: spaceName,
          slug: spaceName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          createdBy: user._id,
        }],
        { session: databaseSession },
      );
      await SpaceMember.create(
        [{ spaceId: space._id, userId: user._id, role: "owner" }],
        { session: databaseSession },
      );
      createdUserId = user.id;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "First-time setup has already been completed.") {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  } finally {
    await databaseSession.endSession();
  }

  const token = await createSession(createdUserId);
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
    return await setup(request);
  } catch (error) {
    const databaseError = toMongoConnectionError(error);
    if (!databaseError) {
      throw error;
    }

    console.error("[setup] MongoDB connection unavailable", {
      issue: databaseError.issue,
    });
    return NextResponse.json(
      { error: databaseError.userMessage },
      { status: 503, headers: { "Retry-After": "5" } },
    );
  }
}
