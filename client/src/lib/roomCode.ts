/** decodeURIComponent that returns the input unchanged when it is malformed. */
export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * People often paste the whole share link instead of just the code. Accept
 * either and return the room code (the first path segment of a pasted URL).
 */
export function extractRoomCode(input: string): string {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;

  try {
    const [segment] = new URL(trimmed).pathname.split("/").filter(Boolean);
    return segment ? safeDecodeURIComponent(segment) : "";
  } catch {
    return trimmed;
  }
}

/** Codes the server accepts for new rooms (see POST /xoomshare). */
const ROOM_CODE_PATTERN = /^[A-Za-z0-9_-]{12,48}$/;

/** The link a second device opens to join a room. */
export function buildRoomLink(origin: string, pathCode: string): string {
  return `${origin.replace(/\/+$/, "")}/${encodeURIComponent(pathCode)}`;
}

/**
 * Turn a scanned QR payload into a room code. Unlike a pasted link, a QR code
 * can come from anywhere, so only accept a bare code or a link to this site.
 * Returns null for anything else (other sites, profiles, malformed input).
 */
export function roomCodeFromScan(payload: string, origin: string): string | null {
  const trimmed = payload.trim();
  if (ROOM_CODE_PATTERN.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.origin !== new URL(origin).origin) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return null;
  const code = safeDecodeURIComponent(segments[0]);
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}
