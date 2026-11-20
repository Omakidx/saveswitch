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
