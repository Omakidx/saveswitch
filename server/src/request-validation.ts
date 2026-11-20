/** UUIDs are used as Postgres primary keys at the HTTP boundary. */
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

/** Request bodies are untrusted: anything that is not a plain object becomes `{}`. */
export const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/** True for Postgres unique_violation, including errors wrapped by drizzle (`cause`). */
export const isUniqueViolation = (error: unknown): boolean => {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    if ((current as { code?: unknown }).code === '23505') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const FUNCTIONAL_COLOR = /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.]+(?:deg|%)?(?:\s*[,\s]\s*[0-9.]+%?){2}(?:\s*[,/]\s*[0-9.]+%?)?\s*\)$/i

/** Strict page colors: hex, or simple rgb()/rgba()/hsl()/hsla() numeric forms. */
export const isSafeCssColor = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 64 && (HEX_COLOR.test(value) || FUNCTIONAL_COLOR.test(value))

/** Top-level client routes and API prefixes that a username or room code must not shadow. */
export const RESERVED_ROUTE_SEGMENTS: ReadonlySet<string> = new Set([
  'api', 'auth', 'dashboard', 'link', 'login', 'public', 'register', 'xoomshare',
  'profile', 'join', 'settings', 'admin', 'health', 'ws', 'users', 'pages', 'resources',
  'favicon', 'favicon.ico', 'robots.txt', 'sitemap.xml', '_next', 'static',
])
