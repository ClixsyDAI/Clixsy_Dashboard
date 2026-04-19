import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

/**
 * POST /api/admin/auth
 * Body: { password: string }
 *
 * Validates the admin password and returns a session token.
 * Password is checked against the ADMIN_PASSWORD env var.
 * Default password: "clixsy2024"
 */
export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    const correct = process.env.ADMIN_PASSWORD || "clixsy2024";

    if (password !== correct) {
      return NextResponse.json(
        { error: "Invalid password" },
        { status: 401 }
      );
    }

    // Generate a simple session token (hash of password + a server-side secret)
    const secret = process.env.ADMIN_SESSION_SECRET || "clixsy-admin-default-secret";
    const token = createHash("sha256")
      .update(`${correct}:${secret}`)
      .digest("hex");

    return NextResponse.json({ token });
  } catch {
    return NextResponse.json(
      { error: "Bad request" },
      { status: 400 }
    );
  }
}

/**
 * GET /api/admin/auth?token=...
 * Validates an existing session token.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ valid: false }, { status: 401 });
  }

  const correct = process.env.ADMIN_PASSWORD || "clixsy2024";
  const secret = process.env.ADMIN_SESSION_SECRET || "clixsy-admin-default-secret";
  const expected = createHash("sha256")
    .update(`${correct}:${secret}`)
    .digest("hex");

  return NextResponse.json({ valid: token === expected });
}
