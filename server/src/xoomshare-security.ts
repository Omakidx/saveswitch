const DEFAULT_MAX_ENTRIES = 10_000

export type RateLimitDecision = {
  allowed: boolean
  retryAfterSeconds: number
}

/** A bounded, per-process fixed-window limiter keyed by a server-observed IP. */
export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>()

  constructor(private readonly maxEntries = DEFAULT_MAX_ENTRIES) {}

  consume(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitDecision {
    for (const [entryKey, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(entryKey)
    }
    while (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }

    const existing = this.entries.get(key)
    if (!existing || existing.resetAt <= now) {
      this.entries.set(key, { count: 1, resetAt: now + windowMs })
      return { allowed: true, retryAfterSeconds: 0 }
    }

    if (existing.count >= limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) }
    }

    existing.count += 1
    return { allowed: true, retryAfterSeconds: 0 }
  }
}

/** Bounded subscribe/query budget for one WebSocket connection. */
export class SocketQueryBudget {
  private readonly entries = new WeakMap<object, { count: number; resetAt: number }>()

  consume(socket: object, limit: number, windowMs: number, now = Date.now()) {
    const current = this.entries.get(socket)
    if (!current || current.resetAt <= now) {
      this.entries.set(socket, { count: 1, resetAt: now + windowMs })
      return true
    }
    if (current.count >= limit) return false
    current.count += 1
    return true
  }
}

export const XOOMSHARE_MAX_RESOURCES = 60
export const XOOMSHARE_MAX_RESOURCE_BYTES = 100 * 1024 * 1024
export const XOOMSHARE_MAX_TITLE_BYTES = 512
export const XOOMSHARE_MAX_DESCRIPTION_BYTES = 2_000
export const XOOMSHARE_MAX_PAGE_NAME_BYTES = 256

export const canReserveXoomshareQuota = ({
  resourceCount,
  resourceBytes,
  incomingBytes,
}: {
  resourceCount: number
  resourceBytes: number
  incomingBytes: number
}) => (
  Number.isInteger(incomingBytes) && incomingBytes >= 0 &&
  resourceCount < XOOMSHARE_MAX_RESOURCES &&
  resourceBytes + incomingBytes <= XOOMSHARE_MAX_RESOURCE_BYTES
)

export const utf8ByteLength = (value: string) => new TextEncoder().encode(value).byteLength
export const isWithinUtf8ByteLimit = (value: string, maxBytes: number) => utf8ByteLength(value) <= maxBytes

/** Keeps whole Unicode code points, so persisted metadata never exceeds a byte cap. */
export const truncateUtf8 = (value: string, maxBytes: number) => {
  let result = ''
  let bytes = 0
  for (const character of value) {
    const characterBytes = utf8ByteLength(character)
    if (bytes + characterBytes > maxBytes) break
    result += character
    bytes += characterBytes
  }
  return result
}

export const xoomshareOptionalFieldBytes = (value: string | null | undefined) =>
  value ? utf8ByteLength(value) : 0

/**
 * Quota accounting includes all variable-length fields stored for a resource.
 * Binary resources retain their decoded input payload cost; text/link content
 * uses its UTF-8 persisted content cost.
 */
export const getXoomshareResourceStorageBytes = ({
  contentBytes,
  title,
  description,
  thumbnailUrl,
}: {
  contentBytes: number
  title?: string | null
  description?: string | null
  thumbnailUrl?: string | null
}) => contentBytes
  + xoomshareOptionalFieldBytes(title)
  + xoomshareOptionalFieldBytes(description)
  + xoomshareOptionalFieldBytes(thumbnailUrl)

export const isXoomsharePageId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
