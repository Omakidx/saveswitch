"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { API_BASE } from "@/lib/api";

type SessionResponse = {
  authenticated?: boolean;
};

/**
 * Keeps an authenticated production user in their workspace. Session validity
 * stays authoritative at the API, which is important when web and API live on
 * separate domains and the session cookie is not visible to Next.js.
 */
export default function ProductionSessionRedirect() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || pathname.startsWith("/dashboard")) {
      return;
    }

    const controller = new AbortController();

    async function redirectAuthenticatedSession() {
      try {
        const response = await fetch(`${API_BASE}/auth/me`, {
          credentials: "include",
          signal: controller.signal,
        });
        const session = (await response.json()) as SessionResponse;

        if (!controller.signal.aborted && response.ok && session.authenticated) {
          router.replace("/dashboard");
        }
      } catch {
        // A temporary API failure must not prevent public routes from rendering.
      }
    }

    void redirectAuthenticatedSession();
    return () => controller.abort();
  }, [pathname, router]);

  return null;
}
