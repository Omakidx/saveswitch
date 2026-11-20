const AUTH_ENTRY_PATHS = new Set(["/", "/login", "/register"]);

/**
 * Only the sign-in entry points bounce a signed-in visitor to the dashboard.
 * Public profiles (/@name) and Xoomshare rooms (/code) must stay reachable
 * while signed in.
 */
export function shouldRedirectAuthenticatedSession(pathname: string | null): boolean {
  if (!pathname) return false;
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return AUTH_ENTRY_PATHS.has(normalized);
}
