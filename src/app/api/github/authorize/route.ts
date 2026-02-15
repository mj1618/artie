import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "GitHub OAuth not configured" },
      { status: 500 },
    );
  }

  const state = crypto.randomUUID();

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    `${req.nextUrl.protocol}//${req.nextUrl.host}`;

  const redirectUrl = new URL("https://github.com/login/oauth/authorize");
  redirectUrl.searchParams.set("client_id", clientId);
  redirectUrl.searchParams.set(
    "redirect_uri",
    `${appUrl}/api/github/callback`,
  );
  redirectUrl.searchParams.set("scope", "repo");
  redirectUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set("github_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
