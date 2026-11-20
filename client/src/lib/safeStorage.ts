/**
 * localStorage can throw on access (blocked site data, some private modes) as
 * well as on write (quota). Persistence here is only a convenience, so every
 * operation degrades to a no-op instead of crashing the page.
 */
export function safeGetItem(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(key: string, value: string): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  } catch {
    // Storage is unavailable or full; the in-memory state remains correct.
  }
}

export function safeRemoveItem(key: string): void {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
  } catch {
    // See safeSetItem.
  }
}
