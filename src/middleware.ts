import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Middleware to conditionally apply Cross-Origin-Embedder-Policy headers.
 * 
 * WebContainer requires COEP for SharedArrayBuffer, but Sandpack's Nodebox
 * doesn't work with COEP. We use a cookie to determine which mode to use:
 * - Cookie "runtime=webcontainer" -> apply COEP headers
 * - No cookie or "runtime=sandpack" -> no COEP headers
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Only apply COEP logic to workspace routes
  if (request.nextUrl.pathname.startsWith("/workspace/")) {
    const runtimeCookie = request.cookies.get("runtime");

    // Apply COEP headers only if runtime cookie is set to webcontainer
    if (runtimeCookie?.value === "webcontainer") {
      response.headers.set("Cross-Origin-Embedder-Policy", "credentialless");
      response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    }
  }

  return response;
}

export const config = {
  matcher: ["/workspace/:path*"],
};
