import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { getUserSpaceMembership } from "@/src/lib/auth";
import { errorJson, isSameOrigin, logApiError, successJson } from "@/src/lib/api-response";
import { connectToDatabase } from "@/src/lib/mongodb";
import { Invitation } from "@/src/models/Invitation";
import { SpaceMember } from "@/src/models/SpaceMember";
import { User } from "@/src/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inviteSchema = z.object({ email: z.string().trim().email().max(254) });

export async function GET() {
  try {
    const auth = await getUserSpaceMembership();
    if (!auth) return errorJson("Sign in to manage your space.", 401);
    if (auth.membership.role !== "owner") return errorJson("Only the space owner can manage members.", 403);
    await connectToDatabase();
    const memberships = await SpaceMember.find({ spaceId: auth.membership.spaceId })
      .sort({ joinedAt: 1 })
      .populate("userId", "email displayName username")
      .lean();
    const invitations = await Invitation.find({
      spaceId: auth.membership.spaceId,
      acceptedAt: null,
      expiresAt: { $gt: new Date() },
    }).select("email expiresAt createdAt").lean();
    return successJson({
      members: memberships.map((entry) => ({
        id: String(entry._id),
        role: entry.role,
        joinedAt: entry.joinedAt,
        user: entry.userId && typeof entry.userId === "object" && "email" in entry.userId
          ? {
              email: entry.userId.email,
              displayName: entry.userId.displayName,
              username: entry.userId.username,
            }
          : null,
      })),
      invitations: invitations.map((invite) => ({
        id: String(invite._id),
        email: invite.email,
        expiresAt: invite.expiresAt,
      })),
    });
  } catch (error) {
    logApiError("members-list", error);
    return errorJson("Space members could not be loaded.", 500);
  }
}

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return errorJson("Invalid request origin.", 403);
    const auth = await getUserSpaceMembership();
    if (!auth) return errorJson("Sign in to invite someone.", 401);
    if (auth.membership.role !== "owner") return errorJson("Only the space owner can invite members.", 403);
    const parsed = inviteSchema.safeParse(await request.json());
    if (!parsed.success) return errorJson("Enter a valid email address.", 400);
    const email = parsed.data.email.toLowerCase();
    await connectToDatabase();
    const existingUser = await User.findOne({ email }).select("_id");
    if (existingUser && await SpaceMember.exists({
      userId: existingUser._id,
      spaceId: auth.membership.spaceId,
    })) {
      return errorJson("That person is already in this space.", 409);
    }
    if (existingUser) {
      await SpaceMember.create({
        spaceId: auth.membership.spaceId,
        userId: existingUser._id,
        role: "member",
      });
      return successJson({ added: true }, 201);
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await Invitation.create({
      spaceId: auth.membership.spaceId,
      invitedBy: auth.user._id,
      email,
      tokenHash,
      role: "member",
      expiresAt,
    });
    const inviteUrl = new URL(`/invite?token=${encodeURIComponent(token)}`, request.url).toString();
    return successJson({ inviteUrl, expiresAt }, 201);
  } catch (error) {
    logApiError("member-invite", error);
    return errorJson("This invitation could not be created.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    if (!isSameOrigin(request)) return errorJson("Invalid request origin.", 403);
    const auth = await getUserSpaceMembership();
    if (!auth) return errorJson("Sign in to manage your space.", 401);
    if (auth.membership.role !== "owner") return errorJson("Only the space owner can remove members.", 403);
    const parsed = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }).safeParse(await request.json());
    if (!parsed.success) return errorJson("Select a valid invitation or member.", 400);
    await connectToDatabase();
    const invitation = await Invitation.findOneAndDelete({
      _id: parsed.data.id,
      spaceId: auth.membership.spaceId,
      acceptedAt: null,
    });
    if (invitation) return successJson({ removed: true });
    const target = await SpaceMember.findOne({
      _id: parsed.data.id,
      spaceId: auth.membership.spaceId,
      role: "member",
    });
    if (!target) return errorJson("That invitation or membership could not be found.", 404);
    await target.deleteOne();
    return successJson({ removed: true });
  } catch (error) {
    logApiError("member-remove", error);
    return errorJson("This member could not be removed.", 500);
  }
}
