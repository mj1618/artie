"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ConvexReactClient, useMutation } from "convex/react";
import { ReactNode, useEffect, useRef } from "react";
import { api } from "../../convex/_generated/api";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

function EnsureProfile() {
  const ensureProfile = useMutation(api.users.ensureProfile);
  const called = useRef(false);
  useEffect(() => {
    if (called.current) return;
    called.current = true;
    ensureProfile().catch(() => {});
  }, [ensureProfile]);
  return null;
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!}
    >
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <EnsureProfile />
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
