"use client";

import { useEffect, useCallback } from "react";
import { API_BASE } from "@/lib/api";

interface GoogleOneTapProps {
  clientId: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
            prompt_parent_id?: string;
            use_fedcm_for_prompt?: boolean;
          }) => void;
          prompt: (
            notification?: (notification: {
              isNotDisplayed: () => boolean;
              isSkippedMoment: () => boolean;
              getNotDisplayedReason: () => string;
              getSkippedReason: () => string;
            }) => void
          ) => void;
          renderButton: (
            element: HTMLElement,
            config: {
              type?: string;
              theme?: string;
              size?: string;
              text?: string;
              shape?: string;
              width?: number;
            }
          ) => void;
          cancel: () => void;
        };
      };
    };
  }
}

export default function GoogleOneTap({ clientId }: GoogleOneTapProps) {
  const handleCredentialResponse = useCallback(
    async (response: { credential: string }) => {
      try {
        const res = await fetch(`${API_BASE}/auth/google/one-tap`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ credential: response.credential }),
        });

        const data = await res.json().catch(() => null);

        if (!res.ok) {
          console.error("One Tap sign-in failed:", data?.error || res.statusText);
          return;
        }

        if (data?.success) {
          // Redirect to dashboard on successful sign-in
          window.location.href = "/dashboard";
        } else {
          console.error("One Tap sign-in failed:", data?.error || "Unknown error");
        }
      } catch (err) {
        console.error("One Tap sign-in error:", err);
      }
    },
    []
  );

  useEffect(() => {
    // Load the Google Identity Services script
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google) {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handleCredentialResponse,
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: true,
        });

        // Show the One Tap prompt
        window.google.accounts.id.prompt();
      }
    };
    document.head.appendChild(script);

    return () => {
      // Cleanup
      if (window.google) {
        window.google.accounts.id.cancel();
      }
      // Remove the script on unmount
      const existingScript = document.querySelector(
        'script[src="https://accounts.google.com/gsi/client"]'
      );
      if (existingScript) {
        existingScript.remove();
      }
    };
  }, [clientId, handleCredentialResponse]);

  // The One Tap UI is rendered by Google's library as an overlay at top-right
  // No visible DOM element needed here
  return null;
}
