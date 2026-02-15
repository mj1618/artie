import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const storedState = req.cookies.get("github_oauth_state")?.value;

  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(
      new URL("/settings?error=github_oauth_failed", req.url),
    );
  }

  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    },
  );

  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) {
    return NextResponse.redirect(
      new URL("/settings?error=github_token_failed", req.url),
    );
  }

  const userResponse = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const githubUser = await userResponse.json();

  const redirectUrl = new URL("/settings", req.url);
  redirectUrl.searchParams.set("github_token", tokenData.access_token);
  redirectUrl.searchParams.set("github_username", githubUser.login);

  const response = NextResponse.redirect(redirectUrl);
  response.cookies.delete("github_oauth_state");
  return response;
}
