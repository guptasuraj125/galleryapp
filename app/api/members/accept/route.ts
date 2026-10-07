import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { hashPassword, SESSION_COOKIE_NAME, SESSION_MAX_AGE, createSession } from "@/src/lib/auth";
import { errorJson, isSameOrigin, logApiError, successJson } from "@/src/lib/api-response";
import { connectToDatabase } from "@/src/lib/mongodb";
import { Invitation } from "@/src/models/Invitation";
import { SpaceMember } from "@/src/models/SpaceMember";
import { User } from "@/src/models/User";

export const runtime = "nodejs";

const acceptSchema = z.object({
  token: z.string().min(20).max(128),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(8).max(72).refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "Password must be at least 8 characters and no more than 72 bytes.",
  ),
});

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return errorJson("Invalid request origin.", 403);
    const parsed = acceptSchema.safeParse(await request.json());
    if (!parsed.success) return errorJson("Check your invite and account details.", 400);
    await connectToDatabase();
    const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
    const invitation = await Invitation.findOne({
      tokenHash,
      acceptedAt: null,
      expiresAt: { $gt: new Date() },
    }).select("+tokenHash");
    if (!invitation) return errorJson("This invitation is invalid or has expired.", 410);
    if (await User.exists({ email: invitation.email })) {
      return errorJson("An account with this email already exists. Sign in and ask the owner to add your account.", 409);
    }
    const passwordHash = await hashPassword(parsed.data.password);
    const prefix = invitation.email
      .split("@")[0]
      .replace(/[^a-z0-9_.-]/gi, "")
      .slice(0, 23) || "memorykeeper";
    const username = `${prefix}_${randomBytes(4).toString("hex")}`.toLowerCase();
    const session = await mongoose.startSession();
    let userId = "";
    try {
      await session.withTransaction(async () => {
        const currentInvite = await Invitation.findOneAndUpdate(
          {
            _id: invitation._id,
            acceptedAt: null,
            expiresAt: { $gt: new Date() },
          },
          { $set: { acceptedAt: new Date() } },
          { new: true, session },
        );
        if (!currentInvite) throw new Error("This invitation has already been used.");
        const [user] = await User.create([{
          email: invitation.email,
          username,
          displayName: parsed.data.displayName,
          passwordHash,
        }], { session });
        await SpaceMember.create([{
          spaceId: invitation.spaceId,
          userId: user._id,
          role: "member",
        }], { session });
        userId = user.id;
      });
    } finally {
      await session.endSession();
    }

    const sessionToken = await createSession(userId);
    const response = successJson({ authenticated: true });
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return response;
  } catch (error) {
    logApiError("member-accept", error);
    return errorJson("This invitation could not be accepted. Please ask the owner for a new one.", 500);
  }
}
