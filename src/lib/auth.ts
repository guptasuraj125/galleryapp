import { createHash, createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { compare, hash } from "bcryptjs";
import { connectToDatabase } from "@/src/lib/mongodb";
import { Session } from "@/src/models/Session";
import { User } from "@/src/models/User";
import { SpaceMember } from "@/src/models/SpaceMember";

const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "ghumi_session";

function hashSessionToken(token: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be configured with at least 32 characters.");
  }
  return createHmac("sha256", secret).update(token).digest("hex");
}

function legacyHashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const byteLength = Buffer.byteLength(password, "utf8");
  if (Array.from(password).length < 8 || byteLength > 72) {
    throw new Error("Passwords must be at least 8 characters and no more than 72 UTF-8 bytes.");
  }
  return hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return compare(password, passwordHash);
}

export async function createSession(userId: string): Promise<string> {
  await connectToDatabase();

  const token = randomBytes(32).toString("base64url");
  await Session.create({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + SESSION_DURATION_SECONDS * 1000),
  });

  return token;
}

export async function revokeSession(token: string): Promise<void> {
  await connectToDatabase();
  await Session.updateOne(
    { tokenHash: { $in: [hashSessionToken(token), legacyHashSessionToken(token)] }, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  await connectToDatabase();
  const sessionHash = hashSessionToken(token);
  const session = await Session.findOne({
    tokenHash: { $in: [sessionHash, legacyHashSessionToken(token)] },
    expiresAt: { $gt: new Date() },
    revokedAt: null,
  }).select("+tokenHash");

  if (!session) {
    return null;
  }
  if (session.tokenHash !== sessionHash) {
    session.tokenHash = sessionHash;
    await session.save();
  }

  const user = await User.findOne({ _id: session.userId, isActive: true }).select(
    "email username displayName",
  );
  return user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

export async function getUserSpaceMembership() {
  const user = await getCurrentUser();
  if (!user) return null;
  await connectToDatabase();
  const membership = await SpaceMember.findOne({ userId: user._id })
    .sort({ joinedAt: 1 })
    .lean();
  return membership ? { user, membership } : null;
}

export const SESSION_MAX_AGE = SESSION_DURATION_SECONDS;
