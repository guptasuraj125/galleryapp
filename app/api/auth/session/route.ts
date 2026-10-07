import { NextResponse } from "next/server";
import { getCurrentUser } from "@/src/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: user.id,
      displayName: user.displayName,
      username: user.username,
    },
  });
}
