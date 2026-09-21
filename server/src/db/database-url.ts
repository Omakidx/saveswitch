const DATABASE_PROTOCOLS = new Set(['postgres:', 'postgresql:'])

/** Parse without ever reflecting the credential-bearing input in an error. */
export const parseDatabaseUrl = (value: string) => {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('DATABASE_URL is invalid')
  }

  if (
    !DATABASE_PROTOCOLS.has(parsed.protocol) ||
    !parsed.hostname ||
    !parsed.username ||
    !parsed.pathname ||
    parsed.pathname === '/'
  ) {
    throw new Error('DATABASE_URL is invalid')
  }

  return parsed
}
