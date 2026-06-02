import { NextResponse } from "next/server";
import { getAuthorizationUrl } from "@/app/lib/basecamp";

export async function GET() {
  const url = getAuthorizationUrl();
  return NextResponse.redirect(url);
}
